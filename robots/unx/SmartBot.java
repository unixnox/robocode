package unx;

import robocode.AdvancedRobot;
import robocode.Bullet;
import robocode.BulletHitBulletEvent;
import robocode.BulletHitEvent;
import robocode.HitByBulletEvent;
import robocode.HitRobotEvent;
import robocode.HitWallEvent;
import robocode.RobotDeathEvent;
import robocode.RoundEndedEvent;
import robocode.Rules;
import robocode.ScannedRobotEvent;
import robocode.util.Utils;

import java.awt.Color;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * SmartBot for classic Robocode (1.9.x / 1.10.x / 1.11.x) - dodges and shoots precisely.
 *
 * <h2>Radar</h2>
 * Locks onto the target in 1v1 (so every enemy shot is detected), spins in melee.
 *
 * <h2>Movement</h2>
 * <ul>
 *   <li>1v1: <b>wave surfing</b>. Enemy shots are detected from their energy drop, tracked as
 *   expanding waves, and the bot predicts where it will be when each wave arrives for three options
 *   (orbit clockwise, orbit counter-clockwise, brake). It picks the option with the lowest learned
 *   danger. Every time we are hit, the danger at that guess factor is increased.</li>
 *   <li>Melee: <b>minimum-risk movement</b>, driving to the candidate point furthest from
 *   enemies and the crowded center.</li>
 *   <li>Wall smoothing keeps the bot from getting stuck against walls.</li>
 * </ul>
 *
 * <h2>Gun</h2>
 * Three <b>virtual guns</b> run in parallel: guess-factor (statistical, segmented on distance,
 * lateral velocity and acceleration), circular targeting and linear targeting. Every shot is
 * tracked as a wave so each gun is scored on whether it <em>would</em> have hit, and the bot always
 * aims with the currently best-scoring gun. Firepower scales with distance, hit rate and
 * energy, and never wastes more energy than needed to finish the enemy off.
 *
 * <p>Classic Robocode conventions: angles in radians, 0 = north, clockwise positive, y up.
 */
public class SmartBot extends AdvancedRobot {

    // ---------------------------------------------------------------- constants

    private static final double BOT_HALF = 18;
    private static final double WALL_MARGIN = 26;
    private static final double WALL_STICK = 140;

    private static final int BINS = 47;
    private static final int MID_BIN = (BINS - 1) / 2;

    private static final int DIST_SEGS = 5;
    private static final int LAT_SEGS = 5;
    private static final int ACCEL_SEGS = 3;

    private static final int GUN_GF = 0;
    private static final int GUN_CIRCULAR = 1;
    private static final int GUN_LINEAR = 2;
    private static final String[] GUN_NAMES = {"GuessFactor", "Circular", "Linear"};

    // ---------------------------------------------------------------- learned data (kept across rounds)

    private static final double[][][][] gunStats = new double[DIST_SEGS][LAT_SEGS][ACCEL_SEGS][BINS];
    private static final double[] gunStatsFlat = new double[BINS];
    private static final double[][] surfStats = new double[DIST_SEGS][BINS];
    private static final double[] surfStatsFlat = new double[BINS];
    private static final double[] gunScores = {0.30, 0.25, 0.20}; // rolling hit rates, slight prior towards GF
    private static int realShots, realHits;

    // ---------------------------------------------------------------- per-round state (new robot instance each round)

    private final Random random = new Random();
    private final Map<String, Enemy> enemies = new HashMap<>();
    private final List<GunWave> gunWaves = new ArrayList<>();
    private final List<EnemyWave> enemyWaves = new ArrayList<>();
    private final List<double[]> myHistory = new ArrayList<>(); // [time, x, y, lateralDir, absBearingFromEnemy]
    private Enemy target;
    private int orbitDirection = 1;
    private long lastDirectionChangeTime;
    private double[] meleeDestination;
    private double pendingAimAngle = Double.NaN;
    private double pendingFirepower;
    private GunWave pendingWave;

    // ================================================================= main loop

    @Override
    public void run() {
        setBodyColor(new Color(0x20, 0x20, 0x30));
        setGunColor(new Color(0x10, 0x60, 0xA0));
        setRadarColor(new Color(0xFF, 0xD0, 0x00));
        setBulletColor(new Color(0x00, 0xFF, 0xC0));
        setScanColor(new Color(0xFF, 0xD0, 0x00));

        setAdjustGunForRobotTurn(true);
        setAdjustRadarForRobotTurn(true);
        setAdjustRadarForGunTurn(true);

        while (true) {
            recordMyState();
            updateEnemyWaves();
            updateGunWaves();
            chooseTarget();
            doRadar();
            doMovement();
            doGun();
            execute();
        }
    }

    // ================================================================= events

    @Override
    public void onScannedRobot(ScannedRobotEvent e) {
        String name = e.getName();
        Enemy en = enemies.get(name);
        if (en == null) {
            en = new Enemy(name);
            enemies.put(name, en);
        }
        long time = getTime();

        boolean continuous = en.lastSeenTime == time - 1;
        double prevX = en.x, prevY = en.y, prevEnergy = en.energy;

        if (en.lastSeenTime >= 0) {
            long dt = Math.max(1, time - en.lastSeenTime);
            en.turnRate = Utils.normalRelativeAngle(e.getHeadingRadians() - en.heading) / dt;
            en.accel = (Math.abs(e.getVelocity()) - Math.abs(en.velocity)) / dt;
        }
        double absBearing = getHeadingRadians() + e.getBearingRadians();
        en.x = getX() + Math.sin(absBearing) * e.getDistance();
        en.y = getY() + Math.cos(absBearing) * e.getDistance();
        en.heading = e.getHeadingRadians();
        en.velocity = e.getVelocity();
        en.energy = e.getEnergy();
        en.lastSeenTime = time;
        en.alive = true;

        // --- Detect enemy shots by the energy drop (only reliable with continuous scans)
        if (continuous) {
            double drop = prevEnergy + en.expectedEnergyDelta - en.energy;
            if (drop >= 0.0999 && drop <= 3.0001 && getOthers() == 1 && myHistory.size() >= 3) {
                addEnemyWave(prevX, prevY, drop, time - 1);
            }
        }
        en.expectedEnergyDelta = 0;
    }

    @Override
    public void onBulletHit(BulletHitEvent e) {
        realHits++;
        Enemy en = enemies.get(e.getName());
        if (en != null) {
            en.expectedEnergyDelta -= Rules.getBulletDamage(e.getBullet().getPower());
        }
    }

    @Override
    public void onHitByBullet(HitByBulletEvent e) {
        Enemy en = enemies.get(e.getName());
        if (en != null) {
            en.expectedEnergyDelta += Rules.getBulletHitBonus(e.getPower()); // shooter regains 3x power
        }
        logEnemyBullet(e.getBullet());
    }

    @Override
    public void onBulletHitBullet(BulletHitBulletEvent e) {
        logEnemyBullet(e.getHitBullet());
    }

    @Override
    public void onHitRobot(HitRobotEvent e) {
        Enemy en = enemies.get(e.getName());
        if (en != null) {
            en.expectedEnergyDelta -= Rules.ROBOT_HIT_DAMAGE;
        }
        orbitDirection = -orbitDirection;
        lastDirectionChangeTime = getTime();
    }

    @Override
    public void onHitWall(HitWallEvent e) {
        orbitDirection = -orbitDirection;
        lastDirectionChangeTime = getTime();
        meleeDestination = null;
    }

    @Override
    public void onRobotDeath(RobotDeathEvent e) {
        Enemy en = enemies.get(e.getName());
        if (en != null) {
            en.alive = false;
        }
        if (target != null && target.name.equals(e.getName())) {
            target = null;
        }
    }

    @Override
    public void onRoundEnded(RoundEndedEvent e) {
        StringBuilder sb = new StringBuilder("Round " + e.getRound() + " ended. Hit rate: ")
                .append(realShots == 0 ? 0 : 100 * realHits / realShots).append("%. Gun scores:");
        for (int g = 0; g < gunScores.length; g++) {
            sb.append(String.format(" %s=%.2f", GUN_NAMES[g], gunScores[g]));
        }
        out.println(sb);
    }

    // ================================================================= targeting selection

    private void chooseTarget() {
        Enemy best = null;
        double bestScore = Double.POSITIVE_INFINITY;
        long time = getTime();
        for (Enemy en : enemies.values()) {
            if (!en.alive || time - en.lastSeenTime > 30) {
                continue;
            }
            // Prefer close and weak enemies; stick with the current target a bit.
            double score = distance(getX(), getY(), en.x, en.y) * (0.6 + en.energy / 100.0);
            if (en == target) {
                score *= 0.8;
            }
            if (score < bestScore) {
                bestScore = score;
                best = en;
            }
        }
        target = best;
    }

    // ================================================================= radar

    private void doRadar() {
        if (target != null && getOthers() == 1 && getTime() - target.lastSeenTime <= 2) {
            // Narrow lock with overshoot so the target stays in the scan arc every turn.
            double delta = Utils.normalRelativeAngle(angleTo(getX(), getY(), target.x, target.y) - getRadarHeadingRadians());
            double overshoot = Math.atan(36 / Math.max(1, distance(getX(), getY(), target.x, target.y)));
            delta += (delta < 0 ? -1 : 1) * overshoot;
            setTurnRadarRightRadians(delta);
        } else {
            setTurnRadarRightRadians(Double.POSITIVE_INFINITY);
        }
    }

    // ================================================================= movement

    private void recordMyState() {
        double lateralDir = orbitDirection;
        double absBearingFromEnemy = 0;
        if (target != null) {
            absBearingFromEnemy = angleTo(target.x, target.y, getX(), getY());
            double lateralVelocity = getVelocity() * Math.sin(getHeadingRadians() - absBearingFromEnemy);
            lateralDir = lateralVelocity >= 0 ? 1 : -1;
        }
        myHistory.add(0, new double[]{getTime(), getX(), getY(), lateralDir, absBearingFromEnemy});
        if (myHistory.size() > 10) {
            myHistory.remove(myHistory.size() - 1);
        }
    }

    private void doMovement() {
        if (target == null) {
            driveTowardsAngle(wallSmoothing(getX(), getY(), getHeadingRadians() + 0.35, 1), 8);
            return;
        }
        if (getOthers() > 1) {
            meleeMovement();
        } else if (!enemyWaves.isEmpty()) {
            surf();
        } else {
            orbitMovement();
        }
    }

    /** Orbit the target with random-ish direction changes (used when no enemy waves are in the air). */
    private void orbitMovement() {
        long time = getTime();
        if (time - lastDirectionChangeTime > 12 + random.nextInt(30)) {
            orbitDirection = -orbitDirection;
            lastDirectionChangeTime = time;
        }
        double absToMe = angleTo(target.x, target.y, getX(), getY());
        double goAngle = absToMe + orbitDirection * (Math.PI / 2 - distanceAdjust(distance(getX(), getY(), target.x, target.y)));
        goAngle = wallSmoothing(getX(), getY(), goAngle, orbitDirection);
        driveTowardsAngle(goAngle, 8);
    }

    /** Radians to angle away from (positive) or towards (negative) the enemy to keep a good distance. */
    private static double distanceAdjust(double distance) {
        return Math.toRadians(clamp((450 - distance) / 8, -25, 35));
    }

    private void surf() {
        EnemyWave wave = closestSurfableWave();
        if (wave == null) {
            orbitMovement();
            return;
        }
        double dangerCw = checkDanger(wave, 1);
        double dangerCcw = checkDanger(wave, -1);
        double dangerStop = checkDanger(wave, 0);

        double sourceToMe = angleTo(wave.x, wave.y, getX(), getY());
        double adjust = distanceAdjust(distance(wave.x, wave.y, getX(), getY()));

        if (dangerStop < dangerCw && dangerStop < dangerCcw) {
            double goAngle = wallSmoothing(getX(), getY(), sourceToMe + orbitDirection * (Math.PI / 2 - adjust), orbitDirection);
            driveTowardsAngle(goAngle, 0);
            return;
        }
        int dir = dangerCw < dangerCcw ? 1 : -1;
        if (dir != orbitDirection) {
            orbitDirection = dir;
            lastDirectionChangeTime = getTime();
        }
        double goAngle = wallSmoothing(getX(), getY(), sourceToMe + dir * (Math.PI / 2 - adjust), dir);
        driveTowardsAngle(goAngle, 8);
    }

    /**
     * Predicts where we will be when the wave hits us if we orbit in direction {@code dir}
     * (1 = clockwise around the source, -1 = counter-clockwise, 0 = brake) and returns the danger there.
     */
    private double checkDanger(EnemyWave wave, int dir) {
        double[] pos = predictPosition(wave, dir);
        int bin = guessFactorBin(wave, pos[0], pos[1]);
        double[] stats = surfStats[wave.segDist];
        double danger = 0;
        for (int i = Math.max(0, bin - 2); i <= Math.min(BINS - 1, bin + 2); i++) {
            double w = 1.0 / (1 + Math.abs(i - bin));
            danger += (stats[i] * 0.7 + surfStatsFlat[i] * 0.3) * w;
        }
        double dist = Math.max(50, distance(wave.x, wave.y, pos[0], pos[1]));
        danger = (danger + 0.01) / dist;
        danger *= 1 + wallDanger(pos[0], pos[1]);
        return danger;
    }

    private double[] predictPosition(EnemyWave wave, int dir) {
        double px = getX(), py = getY();
        double heading = getHeadingRadians();
        double velocity = getVelocity();
        long time = getTime();
        for (int ticks = 0; ticks < 150; ticks++) {
            double sourceToMe = angleTo(wave.x, wave.y, px, py);
            double adjust = distanceAdjust(distance(wave.x, wave.y, px, py));
            int orbit = dir == 0 ? orbitDirection : dir;
            double goAngle = wallSmoothing(px, py, sourceToMe + orbit * (Math.PI / 2 - adjust), orbit);

            double turnAmount = Utils.normalRelativeAngle(goAngle - heading);
            double moveDir = 1;
            if (Math.abs(turnAmount) > Math.PI / 2) {
                turnAmount = Utils.normalRelativeAngle(turnAmount + Math.PI);
                moveDir = -1;
            }
            double maxTurn = Rules.getTurnRateRadians(Math.abs(velocity));
            heading = Utils.normalAbsoluteAngle(heading + clamp(turnAmount, -maxTurn, maxTurn));

            double targetVelocity = dir == 0 ? 0 : 8 * moveDir;
            velocity = nextVelocity(velocity, targetVelocity);
            px += Math.sin(heading) * velocity;
            py += Math.cos(heading) * velocity;
            px = clamp(px, BOT_HALF, getBattleFieldWidth() - BOT_HALF);
            py = clamp(py, BOT_HALF, getBattleFieldHeight() - BOT_HALF);

            time++;
            double traveled = (time - wave.fireTime) * wave.speed;
            if (traveled > distance(wave.x, wave.y, px, py) - BOT_HALF) {
                break;
            }
        }
        return new double[]{px, py};
    }

    private static double nextVelocity(double v, double target) {
        if (v == target) {
            return v;
        }
        if (v > 0 ? target > v : target < v) {
            if (v == 0) {
                return clamp(target, -1, 1);
            }
            return v > 0 ? Math.min(target, v + 1) : Math.max(target, v - 1);
        }
        return v > 0 ? Math.max(target, v - 2) : Math.min(target, v + 2);
    }

    private void meleeMovement() {
        double myX = getX(), myY = getY();
        if (meleeDestination == null
                || distance(myX, myY, meleeDestination[0], meleeDestination[1]) < 25
                || getTime() % 20 == 0) {
            double bestRisk = Double.POSITIVE_INFINITY;
            double[] best = null;
            for (int i = 0; i < 40; i++) {
                double angle = random.nextDouble() * 2 * Math.PI;
                double len = 100 + random.nextDouble() * 150;
                double cx = myX + Math.sin(angle) * len;
                double cy = myY + Math.cos(angle) * len;
                if (cx < WALL_MARGIN * 2 || cy < WALL_MARGIN * 2
                        || cx > getBattleFieldWidth() - WALL_MARGIN * 2 || cy > getBattleFieldHeight() - WALL_MARGIN * 2) {
                    continue;
                }
                double risk = meleeRisk(cx, cy, myX, myY);
                if (risk < bestRisk) {
                    bestRisk = risk;
                    best = new double[]{cx, cy};
                }
            }
            if (best != null) {
                meleeDestination = best;
            }
        }
        if (meleeDestination == null) {
            orbitMovement();
            return;
        }
        double angle = angleTo(myX, myY, meleeDestination[0], meleeDestination[1]);
        driveTowardsAngle(wallSmoothing(myX, myY, angle, orbitDirection), 8);
    }

    private double meleeRisk(double x, double y, double myX, double myY) {
        double risk = 0;
        long time = getTime();
        for (Enemy en : enemies.values()) {
            if (!en.alive || time - en.lastSeenTime > 40) {
                continue;
            }
            double d2 = Math.max(1, (en.x - x) * (en.x - x) + (en.y - y) * (en.y - y));
            // Moving perpendicular to an enemy is safer than moving towards/away from it.
            double alignment = Math.abs(Math.cos(angleTo(myX, myY, x, y) - angleTo(myX, myY, en.x, en.y)));
            risk += Math.min(en.energy, getEnergy() * 2 + 10) / d2 * (1 + alignment);
        }
        // Don't linger in the same spot; the crowded center of a melee is dangerous.
        risk += 0.1 / Math.max(1, (x - myX) * (x - myX) + (y - myY) * (y - myY));
        double cx = getBattleFieldWidth() / 2, cy = getBattleFieldHeight() / 2;
        double centerCloseness = 1 - distance(x, y, cx, cy) / Math.hypot(cx, cy);
        risk *= 1 + centerCloseness;
        return risk;
    }

    private double wallDanger(double x, double y) {
        double d = Math.min(Math.min(x, getBattleFieldWidth() - x), Math.min(y, getBattleFieldHeight() - y));
        return d < 80 ? (80 - d) / 40 : 0;
    }

    /** Turns the requested angle so that a move in that direction does not hit a wall. */
    private double wallSmoothing(double x, double y, double angle, int orbit) {
        double step = (orbit >= 0 ? 1 : -1) * Math.toRadians(4);
        double w = getBattleFieldWidth(), h = getBattleFieldHeight();
        for (int i = 0; i < 90; i++) {
            double tx = x + Math.sin(angle) * WALL_STICK;
            double ty = y + Math.cos(angle) * WALL_STICK;
            if (tx >= WALL_MARGIN && ty >= WALL_MARGIN && tx <= w - WALL_MARGIN && ty <= h - WALL_MARGIN) {
                break;
            }
            angle += step;
        }
        return Utils.normalAbsoluteAngle(angle);
    }

    /** Drives in the direction {@code angle}, using back-as-front when it is quicker. */
    private void driveTowardsAngle(double angle, double speed) {
        double turn = Utils.normalRelativeAngle(angle - getHeadingRadians());
        double dir = 1;
        if (Math.abs(turn) > Math.PI / 2) {
            turn = Utils.normalRelativeAngle(turn + Math.PI);
            dir = -1;
        }
        setTurnRightRadians(turn);
        setMaxVelocity(speed);
        setAhead(100 * dir);
    }

    // ================================================================= enemy waves (dodging)

    private void addEnemyWave(double ex, double ey, double power, long fireTime) {
        // The enemy aimed using our position from the turn before it fired.
        double[] aimState = myHistory.size() > 2 ? myHistory.get(2) : myHistory.get(myHistory.size() - 1);
        EnemyWave w = new EnemyWave();
        w.x = ex;
        w.y = ey;
        w.fireTime = fireTime;
        w.power = power;
        w.speed = Rules.getBulletSpeed(power);
        w.directAngle = angleTo(ex, ey, aimState[1], aimState[2]);
        w.direction = aimState[3];
        w.segDist = Math.min(DIST_SEGS - 1, (int) (distance(ex, ey, aimState[1], aimState[2]) / w.speed / 15));
        enemyWaves.add(w);
    }

    private void updateEnemyWaves() {
        long time = getTime();
        Iterator<EnemyWave> it = enemyWaves.iterator();
        while (it.hasNext()) {
            EnemyWave w = it.next();
            double traveled = (time - w.fireTime) * w.speed;
            if (traveled > distance(w.x, w.y, getX(), getY()) + 50) {
                it.remove();
            }
        }
    }

    private EnemyWave closestSurfableWave() {
        EnemyWave best = null;
        double bestTime = Double.POSITIVE_INFINITY;
        long time = getTime();
        for (EnemyWave w : enemyWaves) {
            double traveled = (time - w.fireTime) * w.speed;
            double remaining = distance(w.x, w.y, getX(), getY()) - traveled;
            if (remaining > w.speed) {
                double t = remaining / w.speed;
                if (t < bestTime) {
                    bestTime = t;
                    best = w;
                }
            }
        }
        return best;
    }

    private int guessFactorBin(EnemyWave w, double x, double y) {
        double offset = Utils.normalRelativeAngle(angleTo(w.x, w.y, x, y) - w.directAngle);
        double gf = clamp(offset / maxEscapeAngle(w.speed), -1, 1) * w.direction;
        return (int) Math.round(gf * MID_BIN) + MID_BIN;
    }

    /** Learns from an enemy bullet that hit us (or hit one of our bullets). */
    private void logEnemyBullet(Bullet b) {
        long time = getTime();
        EnemyWave hitWave = null;
        for (EnemyWave w : enemyWaves) {
            double traveled = (time - w.fireTime) * w.speed;
            if (Math.abs(traveled - distance(w.x, w.y, b.getX(), b.getY())) < 2 * w.speed
                    && Math.abs(b.getVelocity() - w.speed) < 0.5) {
                hitWave = w;
                break;
            }
        }
        if (hitWave == null) {
            return;
        }
        int bin = guessFactorBin(hitWave, b.getX(), b.getY());
        double[] stats = surfStats[hitWave.segDist];
        for (int i = 0; i < BINS; i++) {
            double v = 1.0 / (Math.pow(i - bin, 2) + 1);
            stats[i] += v;
            surfStatsFlat[i] += v;
        }
        enemyWaves.remove(hitWave);
    }

    // ================================================================= gun

    private void doGun() {
        // 1) Fire if the gun reached the angle computed on the previous turn.
        if (!Double.isNaN(pendingAimAngle) && target != null && getGunHeat() == 0 && pendingFirepower > 0) {
            double error = Math.abs(Utils.normalRelativeAngle(pendingAimAngle - getGunHeadingRadians()));
            double dist = distance(getX(), getY(), target.x, target.y);
            double tolerance = Math.atan(BOT_HALF / Math.max(dist, 1));
            if (error <= tolerance && getEnergy() > pendingFirepower) {
                Bullet bullet = setFireBullet(pendingFirepower);
                if (bullet != null) {
                    realShots++;
                    if (pendingWave != null) {
                        pendingWave.real = true; // this wave now carries a real bullet
                    }
                }
            }
        }

        if (target == null || getTime() - target.lastSeenTime > 3) {
            pendingAimAngle = Double.NaN;
            return;
        }

        // 2) Aim for the next turn.
        double power = chooseFirepower();
        double bulletSpeed = Rules.getBulletSpeed(power);
        double myX = getX() + Math.sin(getHeadingRadians()) * getVelocity(); // where the bullet starts
        double myY = getY() + Math.cos(getHeadingRadians()) * getVelocity();
        double absBearing = angleTo(myX, myY, target.x, target.y);
        double dist = distance(myX, myY, target.x, target.y);

        double lateralVelocity = target.velocity * Math.sin(target.heading - absBearing);
        int direction = lateralVelocity >= 0 ? 1 : -1;
        int segDist = Math.min(DIST_SEGS - 1, (int) (dist / bulletSpeed / 12));
        int segLat = latSegment(Math.abs(lateralVelocity));
        int segAccel = target.accel < -0.5 ? 0 : target.accel > 0.5 ? 2 : 1;

        double[] angles = new double[3];
        angles[GUN_GF] = guessFactorAim(absBearing, bulletSpeed, direction, segDist, segLat, segAccel);
        angles[GUN_CIRCULAR] = predictiveAim(myX, myY, bulletSpeed, true);
        angles[GUN_LINEAR] = predictiveAim(myX, myY, bulletSpeed, false);

        int best = 0;
        for (int i = 1; i < gunScores.length; i++) {
            if (gunScores[i] > gunScores[best]) {
                best = i;
            }
        }
        // Stationary targets: aim straight at them.
        double aim = Math.abs(target.velocity) < 0.1 && Math.abs(target.turnRate) < 0.002 ? absBearing : angles[best];

        setTurnGunRightRadians(Utils.normalRelativeAngle(aim - getGunHeadingRadians()));

        // Wave for learning; it starts where the bullet would start.
        GunWave w = new GunWave();
        w.x = myX;
        w.y = myY;
        w.fireTime = getTime() + 1; // it can only be fired on the next turn
        w.speed = bulletSpeed;
        w.directAngle = absBearing;
        w.direction = direction;
        w.segDist = segDist;
        w.segLat = segLat;
        w.segAccel = segAccel;
        w.gunAngles = angles;
        w.targetName = target.name;
        gunWaves.add(w);

        pendingAimAngle = aim;
        pendingFirepower = power;
        pendingWave = w;
    }

    private double chooseFirepower() {
        double dist = distance(getX(), getY(), target.x, target.y);
        double hitRate = realShots < 10 ? 0.2 : (double) realHits / realShots;
        double power;
        if (dist < 120) {
            power = 3;
        } else {
            power = clamp(2.4 - dist / 700 + hitRate * 2, 1.0, 3.0);
        }
        // Save energy when low
        if (getEnergy() < 20) {
            power = Math.min(power, getEnergy() / 10);
        }
        // Don't waste energy: just enough to kill
        double killPower = target.energy > 4 ? (target.energy + 2) / 6 : target.energy / 4;
        power = Math.min(power, Math.max(0.1, killPower + 0.05));
        return clamp(power, 0.1, 3.0);
    }

    private static int latSegment(double lat) {
        if (lat < 1) return 0;
        if (lat < 3) return 1;
        if (lat < 5) return 2;
        if (lat < 7) return 3;
        return 4;
    }

    private double guessFactorAim(double absBearing, double bulletSpeed, int direction,
                                  int segDist, int segLat, int segAccel) {
        double[] stats = gunStats[segDist][segLat][segAccel];
        double total = 0;
        for (double v : stats) total += v;
        double[] use = total > 3 ? stats : gunStatsFlat;

        int bestBin = MID_BIN;
        double bestValue = -1;
        for (int i = 0; i < BINS; i++) {
            double v = use[i];
            if (i > 0) v += use[i - 1] * 0.5;
            if (i < BINS - 1) v += use[i + 1] * 0.5;
            if (v > bestValue) {
                bestValue = v;
                bestBin = i;
            }
        }
        double gf = (double) (bestBin - MID_BIN) / MID_BIN;
        return Utils.normalAbsoluteAngle(absBearing + direction * gf * maxEscapeAngle(bulletSpeed));
    }

    /** Iterative circular (constant turn rate) or linear (straight line) prediction. */
    private double predictiveAim(double myX, double myY, double bulletSpeed, boolean circular) {
        double ex = target.x, ey = target.y;
        double heading = target.heading;
        double velocity = target.velocity;
        double turnRate = circular ? clamp(target.turnRate, -Rules.MAX_TURN_RATE_RADIANS, Rules.MAX_TURN_RATE_RADIANS) : 0;
        double w = getBattleFieldWidth(), h = getBattleFieldHeight();
        for (int t = 1; t < 120; t++) {
            heading += turnRate;
            double nx = ex + Math.sin(heading) * velocity;
            double ny = ey + Math.cos(heading) * velocity;
            if (nx < BOT_HALF || ny < BOT_HALF || nx > w - BOT_HALF || ny > h - BOT_HALF) {
                break; // the enemy would hit the wall: assume it stops there
            }
            ex = nx;
            ey = ny;
            if (t * bulletSpeed >= distance(myX, myY, ex, ey)) {
                break;
            }
        }
        return angleTo(myX, myY, ex, ey);
    }

    private void updateGunWaves() {
        long time = getTime();
        Iterator<GunWave> it = gunWaves.iterator();
        while (it.hasNext()) {
            GunWave w = it.next();
            Enemy en = enemies.get(w.targetName);
            if (en == null || !en.alive || time - en.lastSeenTime > 5) {
                it.remove();
                continue;
            }
            if (en.lastSeenTime != time) {
                continue; // wait for fresh data on the target
            }
            double traveled = (time - w.fireTime) * w.speed;
            double dist = distance(w.x, w.y, en.x, en.y);
            if (traveled < dist - BOT_HALF) {
                continue;
            }
            // Wave reached the enemy: log where it actually was.
            double actual = angleTo(w.x, w.y, en.x, en.y);
            double offset = Utils.normalRelativeAngle(actual - w.directAngle);
            double gf = clamp(offset / maxEscapeAngle(w.speed), -1, 1) * w.direction;
            int bin = (int) Math.round(gf * MID_BIN) + MID_BIN;

            double weight = w.real ? 1.0 : 0.2;
            double[] stats = gunStats[w.segDist][w.segLat][w.segAccel];
            for (int i = 0; i < BINS; i++) {
                double v = weight / (Math.pow(i - bin, 2) + 1);
                stats[i] += v;
                gunStatsFlat[i] += v;
            }

            // Score virtual guns: would each gun's angle have hit?
            if (w.real) {
                double halfWidth = Math.atan(BOT_HALF / Math.max(dist, 1));
                for (int g = 0; g < gunScores.length; g++) {
                    boolean hit = Math.abs(Utils.normalRelativeAngle(w.gunAngles[g] - actual)) <= halfWidth;
                    gunScores[g] = gunScores[g] * 0.95 + (hit ? 0.05 : 0);
                }
            }
            it.remove();
        }
    }

    // ================================================================= helpers

    private static double maxEscapeAngle(double bulletSpeed) {
        return Math.asin(Rules.MAX_VELOCITY / bulletSpeed);
    }

    /** Absolute angle (0 = north, clockwise) from one point to another. */
    private static double angleTo(double fromX, double fromY, double toX, double toY) {
        return Utils.normalAbsoluteAngle(Math.atan2(toX - fromX, toY - fromY));
    }

    private static double distance(double x1, double y1, double x2, double y2) {
        return Math.hypot(x2 - x1, y2 - y1);
    }

    private static double clamp(double v, double min, double max) {
        return Math.max(min, Math.min(max, v));
    }

    // ================================================================= data classes

    private static final class Enemy {
        final String name;
        double x, y, heading, velocity, energy = 100;
        double turnRate, accel;
        double expectedEnergyDelta;
        long lastSeenTime = -1;
        boolean alive = true;

        Enemy(String name) {
            this.name = name;
        }
    }

    private static final class EnemyWave {
        double x, y, power, speed, directAngle, direction;
        long fireTime;
        int segDist;
    }

    private static final class GunWave {
        double x, y, speed, directAngle, direction;
        long fireTime;
        int segDist, segLat, segAccel;
        String targetName;
        double[] gunAngles;
        boolean real;
    }
}
