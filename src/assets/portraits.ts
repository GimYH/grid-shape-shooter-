import { ArchetypeId } from '../types/game';
import lancerPortrait from './images/cyber_operator_lancer_1794503890682.jpg';
import wavePortrait from './images/cyber_operator_wave.jpg';
import sniperPortrait from './images/cyber_operator_sniper_1794503906250.jpg';
import painterPortrait from './images/cyber_operator_painter.jpg';
import transporterPortrait from './images/cyber_operator_transporter.jpg';
import speedsterPortrait from './images/cyber_operator_speedster.jpg';

// One portrait per archetype, shown in character select and the battle HUD.
// Monochrome has no portrait yet (image batch limit) — lancer art stands in
// until its own portrait is generated.
export const ARCHETYPE_PORTRAITS: Record<ArchetypeId, string> = {
  lancer: lancerPortrait,
  wave: wavePortrait,
  sniper: sniperPortrait,
  painter: painterPortrait,
  transporter: transporterPortrait,
  speedster: speedsterPortrait,
  monochrome: lancerPortrait,
};
