// Headless battle harness for testing SmartBot. See README.md ("Battle-testing locally").
import dev.robocode.tankroyale.runner.*;
import java.util.*;
public class Arena {
  public static void main(String[] a) throws Exception {
    String base = a[0]; boolean melee = a[1].equals("melee"); int rounds = Integer.parseInt(a[2]);
    List<BotEntry> bots = new ArrayList<>();
    for (int i = 3; i < a.length; i++) bots.add(BotEntry.of(base + "/" + a[i]));
    try (var runner = BattleRunner.create(b -> b.embeddedServer())) {
      var setup = melee ? BattleSetup.melee(s -> s.setNumberOfRounds(rounds)) : BattleSetup.classic(s -> s.setNumberOfRounds(rounds));
      var res = runner.runBattle(setup, bots);
      for (var r : res.getResults()) System.out.printf("#%d %-12s score=%5d survival=%5d bulletDmg=%5d firsts=%d%n", r.getRank(), r.getName(), r.getTotalScore(), r.getSurvival(), r.getBulletDamage(), r.getFirstPlaces());
    }
  }
}
