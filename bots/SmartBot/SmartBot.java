import dev.robocode.tankroyale.botapi.Bot;
import dev.robocode.tankroyale.botapi.BulletState;
import dev.robocode.tankroyale.botapi.graphics.Color;
import dev.robocode.tankroyale.botapi.events.BotDeathEvent;
import dev.robocode.tankroyale.botapi.events.BulletFiredEvent;
import dev.robocode.tankroyale.botapi.events.BulletHitBotEvent;
import dev.robocode.tankroyale.botapi.events.BulletHitBulletEvent;
import dev.robocode.tankroyale.botapi.events.HitBotEvent;
import dev.robocode.tankroyale.botapi.events.HitByBulletEvent;
import dev.robocode.tankroyale.botapi.events.HitWallEvent;
import dev.robocode.tankroyale.botapi.events.RoundEndedEvent;
import dev.robocode.tankroyale.botapi.events.ScannedBotEvent;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * SmartBot - a Robocode Tank Royale bot that dodges and shoots precisely.
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
 *   enemies and walls.</li>
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
 * <p>Tank Royale conventions: angles are in degrees, 0 = east, counter-clockwise positive, y up.
 */
public class SmartBot extends Bot {

    // ---------------------------------------------------------------- constants

    private static final double BOT_HALF = 18; // bounding circle radius
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

    // ---------------------------------------------------------------- per-round state

    private final Random random = new Random();
    private final Map<Integer, Enemy> enemies = new HashMap<>();
    private final List<GunWave> gunWaves = new ArrayList<>();
    private final List<EnemyWave> enemyWaves = new ArrayList<>();
    private final List<double[]> myHistory = new ArrayList<>(); // [turn, x, y, lateralDir, absBearingFromEnemy]
    private Enemy target;
    private int orbitDirection = 1;
    private int lastDirectionChangeTurn;
    private double[] meleeDestination;
    private double pendingAimAngle = Double.NaN;
    private double pendingFirepower;
    private GunWave pendingWave;

    public static void main(String[] args) {
        new SmartBot().start();
    }

    // ================================================================= main loop

    @Override
    public void run() {
        setBodyColor(Color.fromRgb(0x20, 0x20, 0x30));
        setTurretColor(Color.fromRgb(0x00, 0xB0, 0xFF));
        setRadarColor(Color.fromRgb(0xFF, 0xD0, 0x00));
        setGunColor(Color.fromRgb(0x10, 0x60, 0xA0));
        setBulletColor(Color.fromRgb(0x00, 0xFF, 0xC0));
        setScanColor(Color.fromRgb(0xFF, 0xD0, 0x00));
        setTracksColor(Color.fromRgb(0x40, 0x40, 0x40));

        setAdjustGunForBodyTurn(true);
        setAdjustRadarForBodyTurn(true);
        setAdjustRadarForGunTurn(true);
        setFireAssist(false);

        enemies.clear();
        gunWaves.clear();
        enemyWaves.clear();
        myHistory.clear();
        target = null;
        meleeDestination = null;
        pendingAimAngle = Double.NaN;
        pendingWave = null;

        while (isRunning()) {
            recordMyState();
            updateEnemyWaves();
            updateGunWaves();
            chooseTarget();
            doRadar();
            doMovement();
            doGun();
            go();
        }
    }

    // ================================================================= events

    @Override
    public void onScannedBot(ScannedBotEvent e) {
        int id = e.getScannedBotId();
        Enemy en = enemies.computeIfAbsent(id, k -> new Enemy(id));
        int turn = e.getTurnNumber();

        boolean continuous = en.lastSeenTurn == turn - 1;
        double prevX = en.x, prevY = en.y, prevEnergy = en.energy;

        // Direction delta per turn (for circular targeting) and acceleration
        if (en.lastSeenTurn >= 0) {
            int dt = Math.max(1, turn - en.lastSeenTurn);
            en.turnRate = normalizeRelativeAngle(e.getDirection() - en.direction) / dt;
            en.accel = (Math.abs(e.getSpeed()) - Math.abs(en.speed)) / dt;
        }
        en.x = e.getX();
        en.y = e.getY();
        en.direction = e.getDirection();
        en.speed = e.getSpeed();
        en.energy = e.getEnergy();
        en.lastSeenTurn = turn;
        en.alive = true;

        // --- Detect enemy shots by the energy drop (only reliable with continuous scans)
        if (continuous) {
            double drop = prevEnergy + en.expectedEnergyDelta - en.energy;
            if (drop >= 0.0999 && drop <= 3.0001 && getEnemyCount() == 1 && myHistory.size() >= 3) {
                addEnemyWave(prevX, prevY, drop, turn - 1);
            }
        }
        en.expectedEnergyDelta = 0;
    }

    @Override
    public void onBulletFired(BulletFiredEvent e) {
        realShots++;
    }

    @Override
    public void onBulletHit(BulletHitBotEvent e) {
        realHits++;
        Enemy en = enemies.get(e.getVictimId());
        if (en != null) {
            en.expectedEnergyDelta -= e.getDamage();
        }
    }

    @Override
    public void onHitByBullet(HitByBulletEvent e) {
        BulletState b = e.getBullet();
        Enemy en = enemies.get(b.getOwnerId());
        if (en != null) {
            en.expectedEnergyDelta += 3 * b.getPower(); // shooter regains 3x power
        }
        logEnemyBullet(b);
    }

    @Override
    public void onBulletHitBullet(BulletHitBulletEvent e) {
        logEnemyBullet(e.getHitBullet());
    }

    @Override
    public void onHitBot(HitBotEvent e) {
        Enemy en = enemies.get(e.getVictimId());
        if (en != null) {
            en.expectedEnergyDelta -= 0.6; // ram damage
        }
        orbitDirection = -orbitDirection;
        lastDirectionChangeTurn = getTurnNumber();
    }

    @Override
    public void onHitWall(HitWallEvent e) {
        orbitDirection = -orbitDirection;
        lastDirectionChangeTurn = getTurnNumber();
        meleeDestination = null;
    }

    @Override
    public void onBotDeath(BotDeathEvent e) {
        Enemy en = enemies.get(e.getVictimId());
        if (en != null) {
            en.alive = false;
        }
        if (target != null && target.id == e.getVictimId()) {
            target = null;
        }
    }

    @Override
    public void onRoundEnded(RoundEndedEvent e) {
        StringBuilder sb = new StringBuilder("Round " + e.getRoundNumber() + " ended. Hit rate: ")
                .append(realShots == 0 ? 0 : 100 * realHits / realShots).append("%. Gun scores:");
        for (int g = 0; g < gunScores.length; g++) {
            sb.append(String.format(" %s=%.2f", GUN_NAMES[g], gunScores[g]));
        }
        System.out.println(sb);
    }

    // ================================================================= targeting selection

    private void chooseTarget() {
        Enemy best = null;
        double bestScore = Double.POSITIVE_INFINITY;
        int turn = getTurnNumber();
        for (Enemy en : enemies.values()) {
            if (!en.alive || turn - en.lastSeenTurn > 30) {
                continue;
            }
            // Prefer close and weak enemies; stick with the current target a bit.
            double score = distanceTo(en.x, en.y) * (0.6 + en.energy / 100.0);
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
        int turn = getTurnNumber();
        if (target != null && getEnemyCount() == 1 && turn - target.lastSeenTurn <= 2) {
            // Narrow lock with overshoot so the target stays in the scan arc every turn.
            double delta = normalizeRelativeAngle(directionTo(target.x, target.y) - getRadarDirection());
            double overshoot = Math.toDegrees(Math.atan(36 / Math.max(1, distanceTo(target.x, target.y))));
            delta += Math.signum(delta == 0 ? 1 : delta) * overshoot;
            setTurnRadarLeft(clamp(delta, -45, 45));
        } else {
            setTurnRadarLeft(10_000); // keep spinning
        }
    }

    // ================================================================= movement

    private void recordMyState() {
        double lateralDir = orbitDirection;
        double absBearingFromEnemy = 0;
        if (target != null) {
            absBearingFromEnemy = angleTo(target.x, target.y, getX(), getY());
            double lateralVelocity = getSpeed() * Math.sin(Math.toRadians(getDirection() - absBearingFromEnemy));
            lateralDir = lateralVelocity >= 0 ? 1 : -1;
        }
        myHistory.add(0, new double[]{getTurnNumber(), getX(), getY(), lateralDir, absBearingFromEnemy});
        if (myHistory.size() > 10) {
            myHistory.remove(myHistory.size() - 1);
        }
    }

    private void doMovement() {
        if (target == null) {
            driveTowardsAngle(wallSmoothing(getX(), getY(), getDirection() + 20, 1), 8);
            return;
        }
        if (getEnemyCount() > 1) {
            meleeMovement();
        } else if (!enemyWaves.isEmpty()) {
            surf();
        } else {
            orbitMovement();
        }
    }

    /** Orbit the target with random-ish direction changes (used when no enemy waves are in the air). */
    private void orbitMovement() {
        int turn = getTurnNumber();
        if (turn - lastDirectionChangeTurn > 12 + random.nextInt(30)) {
            orbitDirection = -orbitDirection;
            lastDirectionChangeTurn = turn;
        }
        double absToMe = angleTo(target.x, target.y, getX(), getY());
        double goAngle = absToMe + orbitDirection * (90 - distanceAdjust(distanceTo(target.x, target.y)));
        goAngle = wallSmoothing(getX(), getY(), goAngle, orbitDirection);
        driveTowardsAngle(goAngle, 8);
    }

    /** Degrees to angle away from (positive) or towards (negative) the enemy to keep a good distance. */
    private double distanceAdjust(double distance) {
        return clamp((450 - distance) / 8, -25, 35);
    }

    private void surf() {
        EnemyWave wave = closestSurfableWave();
        if (wave == null) {
            orbitMovement();
            return;
        }
        double dangerLeft = checkDanger(wave, 1);
        double dangerRight = checkDanger(wave, -1);
        double dangerStop = checkDanger(wave, 0);

        double sourceToMe = angleTo(wave.x, wave.y, getX(), getY());
        double adjust = distanceAdjust(distance(wave.x, wave.y, getX(), getY()));

        if (dangerStop < dangerLeft && dangerStop < dangerRight) {
            // Braking is safest: keep the orientation but stop.
            double goAngle = wallSmoothing(getX(), getY(), sourceToMe + orbitDirection * (90 - adjust), orbitDirection);
            driveTowardsAngle(goAngle, 0);
            return;
        }
        int dir = dangerLeft < dangerRight ? 1 : -1;
        if (dir != orbitDirection) {
            orbitDirection = dir;
            lastDirectionChangeTurn = getTurnNumber();
        }
        double goAngle = wallSmoothing(getX(), getY(), sourceToMe + dir * (90 - adjust), dir);
        driveTowardsAngle(goAngle, 8);
    }

    /**
     * Predicts where we will be when the wave hits us if we orbit in direction {@code dir}
     * (1 = counter-clockwise around the source, -1 = clockwise, 0 = brake) and returns the danger there.
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
        // Being far from the source gives more time to react; walls are bad.
        double dist = Math.max(50, distance(wave.x, wave.y, pos[0], pos[1]));
        danger = (danger + 0.01) / dist;
        danger *= 1 + wallDanger(pos[0], pos[1]);
        return danger;
    }

    private double[] predictPosition(EnemyWave wave, int dir) {
        double px = getX(), py = getY();
        double heading = getDirection();
        double speed = getSpeed();
        int turn = getTurnNumber();
        for (int ticks = 0; ticks < 150; ticks++) {
            double sourceToMe = angleTo(wave.x, wave.y, px, py);
            double adjust = distanceAdjust(distance(wave.x, wave.y, px, py));
            int orbit = dir == 0 ? orbitDirection : dir;
            double goAngle = wallSmoothing(px, py, sourceToMe + orbit * (90 - adjust), orbit);

            double turnAmount = normalizeRelativeAngle(goAngle - heading);
            double moveDir = 1;
            if (Math.abs(turnAmount) > 90) {
                turnAmount = normalizeRelativeAngle(turnAmount + 180);
                moveDir = -1;
            }
            double maxTurn = 10 - 0.75 * Math.abs(speed);
            heading = normalizeAbsoluteAngle(heading + clamp(turnAmount, -maxTurn, maxTurn));

            double targetSpeed = dir == 0 ? 0 : 8 * moveDir;
            speed = nextSpeed(speed, targetSpeed);
            px += Math.cos(Math.toRadians(heading)) * speed;
            py += Math.sin(Math.toRadians(heading)) * speed;
            px = clamp(px, BOT_HALF, getArenaWidth() - BOT_HALF);
            py = clamp(py, BOT_HALF, getArenaHeight() - BOT_HALF);

            turn++;
            double traveled = (turn - wave.fireTurn) * wave.speed;
            if (traveled > distance(wave.x, wave.y, px, py) - BOT_HALF) {
                break;
            }
        }
        return new double[]{px, py};
    }

    private static double nextSpeed(double speed, double targetSpeed) {
        if (speed == targetSpeed) {
            return speed;
        }
        if (speed > 0 ? targetSpeed > speed : targetSpeed < speed) {
            // accelerating in the current direction (or from zero)
            if (speed == 0) {
                return clamp(targetSpeed, -1, 1);
            }
            return speed > 0 ? Math.min(targetSpeed, speed + 1) : Math.max(targetSpeed, speed - 1);
        }
        // decelerating (possibly through zero)
        return speed > 0 ? Math.max(targetSpeed, speed - 2) : Math.min(targetSpeed, speed + 2);
    }

    private void meleeMovement() {
        double myX = getX(), myY = getY();
        if (meleeDestination == null
                || distance(myX, myY, meleeDestination[0], meleeDestination[1]) < 25
                || getTurnNumber() % 20 == 0) {
            double bestRisk = Double.POSITIVE_INFINITY;
            double[] best = null;
            for (int i = 0; i < 40; i++) {
                double angle = random.nextDouble() * 360;
                double len = 100 + random.nextDouble() * 150;
                double cx = myX + Math.cos(Math.toRadians(angle)) * len;
                double cy = myY + Math.sin(Math.toRadians(angle)) * len;
                if (cx < WALL_MARGIN * 2 || cy < WALL_MARGIN * 2
                        || cx > getArenaWidth() - WALL_MARGIN * 2 || cy > getArenaHeight() - WALL_MARGIN * 2) {
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
        int turn = getTurnNumber();
        for (Enemy en : enemies.values()) {
            if (!en.alive || turn - en.lastSeenTurn > 40) {
                continue;
            }
            double d2 = Math.max(1, (en.x - x) * (en.x - x) + (en.y - y) * (en.y - y));
            // Moving perpendicular to an enemy is safer than moving towards/away from it.
            double alignment = Math.abs(Math.cos(Math.toRadians(angleTo(myX, myY, x, y) - angleTo(myX, myY, en.x, en.y))));
            risk += Math.min(en.energy, getEnergy() * 2 + 10) / d2 * (1 + alignment);
        }
        // Don't linger in the same spot; the crowded center of a melee is dangerous.
        risk += 0.1 / Math.max(1, (x - myX) * (x - myX) + (y - myY) * (y - myY));
        double cx = getArenaWidth() / 2.0, cy = getArenaHeight() / 2.0;
        double centerCloseness = 1 - distance(x, y, cx, cy) / Math.hypot(cx, cy);
        risk *= 1 + centerCloseness;
        return risk;
    }

    private double wallDanger(double x, double y) {
        double d = Math.min(Math.min(x, getArenaWidth() - x), Math.min(y, getArenaHeight() - y));
        return d < 80 ? (80 - d) / 40 : 0;
    }

    /** Turns the requested angle so that a move in that direction does not hit a wall. */
    private double wallSmoothing(double x, double y, double angle, int orbit) {
        int step = orbit >= 0 ? 1 : -1;
        for (int i = 0; i < 90; i++) {
            double tx = x + Math.cos(Math.toRadians(angle)) * WALL_STICK;
            double ty = y + Math.sin(Math.toRadians(angle)) * WALL_STICK;
            if (tx >= WALL_MARGIN && ty >= WALL_MARGIN
                    && tx <= getArenaWidth() - WALL_MARGIN && ty <= getArenaHeight() - WALL_MARGIN) {
                break;
            }
            angle += 4 * step;
        }
        return normalizeAbsoluteAngle(angle);
    }

    /** Drives in the direction {@code angle}, using back-as-front when it is quicker. */
    private void driveTowardsAngle(double angle, double speed) {
        double turn = normalizeRelativeAngle(angle - getDirection());
        double dir = 1;
        if (Math.abs(turn) > 90) {
            turn = normalizeRelativeAngle(turn + 180);
            dir = -1;
        }
        setTurnLeft(turn);
        setTargetSpeed(speed * dir);
    }

    // ================================================================= enemy waves (dodging)

    private void addEnemyWave(double ex, double ey, double power, int fireTurn) {
        // The enemy aimed using our position from the turn before it fired.
        double[] aimState = myHistory.size() > 2 ? myHistory.get(2) : myHistory.get(myHistory.size() - 1);
        EnemyWave w = new EnemyWave();
        w.x = ex;
        w.y = ey;
        w.fireTurn = fireTurn;
        w.power = power;
        w.speed = calcBulletSpeed(power);
        w.directAngle = angleTo(ex, ey, aimState[1], aimState[2]);
        w.direction = aimState[3];
        w.segDist = Math.min(DIST_SEGS - 1, (int) (distance(ex, ey, aimState[1], aimState[2]) / w.speed / 15));
        enemyWaves.add(w);
    }

    private void updateEnemyWaves() {
        int turn = getTurnNumber();
        Iterator<EnemyWave> it = enemyWaves.iterator();
        while (it.hasNext()) {
            EnemyWave w = it.next();
            double traveled = (turn - w.fireTurn) * w.speed;
            if (traveled > distance(w.x, w.y, getX(), getY()) + 50) {
                it.remove();
            }
        }
    }

    private EnemyWave closestSurfableWave() {
        EnemyWave best = null;
        double bestTime = Double.POSITIVE_INFINITY;
        int turn = getTurnNumber();
        for (EnemyWave w : enemyWaves) {
            double traveled = (turn - w.fireTurn) * w.speed;
            double remaining = distance(w.x, w.y, getX(), getY()) - traveled;
            if (remaining > w.speed) {
                double time = remaining / w.speed;
                if (time < bestTime) {
                    bestTime = time;
                    best = w;
                }
            }
        }
        return best;
    }

    private int guessFactorBin(EnemyWave w, double x, double y) {
        double offset = normalizeRelativeAngle(angleTo(w.x, w.y, x, y) - w.directAngle);
        double gf = clamp(offset / maxEscapeAngle(w.speed), -1, 1) * w.direction;
        return (int) Math.round(gf * MID_BIN) + MID_BIN;
    }

    /** Learns from an enemy bullet that hit us (or hit one of our bullets). */
    private void logEnemyBullet(BulletState b) {
        int turn = getTurnNumber();
        EnemyWave hitWave = null;
        for (EnemyWave w : enemyWaves) {
            double traveled = (turn - w.fireTurn) * w.speed;
            if (Math.abs(traveled - distance(w.x, w.y, b.getX(), b.getY())) < 2 * w.speed
                    && Math.abs(b.getSpeed() - w.speed) < 0.5) {
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
        boolean fired = false;
        if (!Double.isNaN(pendingAimAngle) && target != null && getGunHeat() == 0 && pendingFirepower > 0) {
            double error = Math.abs(normalizeRelativeAngle(pendingAimAngle - getGunDirection()));
            double dist = distanceTo(target.x, target.y);
            double tolerance = Math.toDegrees(Math.atan(BOT_HALF / Math.max(dist, 1)));
            if (error <= tolerance && getEnergy() > pendingFirepower) {
                fired = setFire(pendingFirepower);
                if (fired && pendingWave != null) {
                    pendingWave.real = true; // this wave now carries a real bullet
                }
            }
        }
        if (!fired) {
            setFire(0); // the gun otherwise keeps firing automatically
        }

        if (target == null || getTurnNumber() - target.lastSeenTurn > 3) {
            pendingAimAngle = Double.NaN;
            return;
        }

        // 2) Aim for the next turn.
        double power = chooseFirepower();
        double bulletSpeed = calcBulletSpeed(power);
        double myX = getX() + Math.cos(Math.toRadians(getDirection())) * getSpeed(); // where the bullet starts
        double myY = getY() + Math.sin(Math.toRadians(getDirection())) * getSpeed();
        double absBearing = angleTo(myX, myY, target.x, target.y);
        double dist = distance(myX, myY, target.x, target.y);

        double lateralVelocity = target.speed * Math.sin(Math.toRadians(target.direction - absBearing));
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
        // Stationary / nearly stationary targets: aim straight at them.
        double aim = Math.abs(target.speed) < 0.1 && Math.abs(target.turnRate) < 0.1 ? absBearing : angles[best];

        setTurnGunLeft(normalizeRelativeAngle(aim - getGunDirection()));

        // Wave for learning; it starts where the bullet would start on this turn.
        GunWave w = new GunWave();
        w.x = myX;
        w.y = myY;
        w.fireTurn = getTurnNumber() + 1; // it can only be fired on the next turn
        w.power = power;
        w.speed = bulletSpeed;
        w.directAngle = absBearing;
        w.direction = direction;
        w.segDist = segDist;
        w.segLat = segLat;
        w.segAccel = segAccel;
        w.gunAngles = angles;
        w.targetId = target.id;
        gunWaves.add(w);

        pendingAimAngle = aim;
        pendingFirepower = power;
        pendingWave = w;
    }

    private double chooseFirepower() {
        double dist = distanceTo(target.x, target.y);
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
            // small kernel smoothing
            double v = use[i];
            if (i > 0) v += use[i - 1] * 0.5;
            if (i < BINS - 1) v += use[i + 1] * 0.5;
            if (v > bestValue) {
                bestValue = v;
                bestBin = i;
            }
        }
        double gf = (double) (bestBin - MID_BIN) / MID_BIN;
        return normalizeAbsoluteAngle(absBearing + direction * gf * maxEscapeAngle(bulletSpeed));
    }

    /** Iterative circular (constant turn rate) or linear (straight line) prediction. */
    private double predictiveAim(double myX, double myY, double bulletSpeed, boolean circular) {
        double ex = target.x, ey = target.y;
        double heading = target.direction;
        double speed = target.speed;
        double turnRate = circular ? clamp(target.turnRate, -10, 10) : 0;
        double w = getArenaWidth(), h = getArenaHeight();
        for (int t = 1; t < 120; t++) {
            heading += turnRate;
            double nx = ex + Math.cos(Math.toRadians(heading)) * speed;
            double ny = ey + Math.sin(Math.toRadians(heading)) * speed;
            if (nx < BOT_HALF || ny < BOT_HALF || nx > w - BOT_HALF || ny > h - BOT_HALF) {
                // The enemy would hit the wall: assume it stops there.
                break;
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
        int turn = getTurnNumber();
        Iterator<GunWave> it = gunWaves.iterator();
        while (it.hasNext()) {
            GunWave w = it.next();
            Enemy en = enemies.get(w.targetId);
            if (en == null || !en.alive || turn - en.lastSeenTurn > 5) {
                it.remove();
                continue;
            }
            if (en.lastSeenTurn != turn) {
                continue; // wait for fresh data on the target
            }
            double traveled = (turn - w.fireTurn) * w.speed;
            double dist = distance(w.x, w.y, en.x, en.y);
            if (traveled < dist - BOT_HALF) {
                continue;
            }
            // Wave reached the enemy: log where it actually was.
            double actual = angleTo(w.x, w.y, en.x, en.y);
            double offset = normalizeRelativeAngle(actual - w.directAngle);
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
                double halfWidth = Math.toDegrees(Math.atan(BOT_HALF / Math.max(dist, 1)));
                for (int g = 0; g < gunScores.length; g++) {
                    boolean hit = Math.abs(normalizeRelativeAngle(w.gunAngles[g] - actual)) <= halfWidth;
                    gunScores[g] = gunScores[g] * 0.95 + (hit ? 0.05 : 0);
                }
            }
            it.remove();
        }
    }

    // ================================================================= helpers

    private static double maxEscapeAngle(double bulletSpeed) {
        return Math.toDegrees(Math.asin(8.0 / bulletSpeed));
    }

    private static double angleTo(double fromX, double fromY, double toX, double toY) {
        double a = Math.toDegrees(Math.atan2(toY - fromY, toX - fromX));
        return a < 0 ? a + 360 : a;
    }

    private static double distance(double x1, double y1, double x2, double y2) {
        return Math.hypot(x2 - x1, y2 - y1);
    }

    private static double clamp(double v, double min, double max) {
        return Math.max(min, Math.min(max, v));
    }

    // ================================================================= data classes

    private static final class Enemy {
        final int id;
        double x, y, direction, speed, energy = 100;
        double turnRate, accel;
        double expectedEnergyDelta;
        int lastSeenTurn = -1;
        boolean alive = true;

        Enemy(int id) {
            this.id = id;
        }
    }

    private static final class EnemyWave {
        double x, y, power, speed, directAngle, direction;
        int fireTurn, segDist;
    }

    private static final class GunWave {
        double x, y, power, speed, directAngle, direction;
        int fireTurn, segDist, segLat, segAccel, targetId;
        double[] gunAngles;
        boolean real;
    }
}
