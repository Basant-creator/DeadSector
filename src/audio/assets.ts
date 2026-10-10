import Phaser from 'phaser';
import { STEMS, stemKey } from './music';
import { renderPlaceholderStems } from './placeholderMusic';

/**
 * Audio files that ship with the game, found at build time: only files that exist are ever
 * requested, so a missing file is never a failed load. See src/assets/audio/README.md for the
 * names. Several formats of one sound (drums.ogg and drums.mp3) are offered together and the
 * browser picks the one it plays.
 */
const FOUND = import.meta.glob('../assets/audio/*/*.{ogg,mp3,m4a,wav}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export interface AudioFile {
  /** Cache key: `music-<stem>` for music, the effect's own key (e.g. `sfx-pistol`) for effects. */
  readonly key: string;
  readonly urls: string[];
}

/** Every audio file present, grouped by the key it provides. */
export function audioFiles(): AudioFile[] {
  const byKey = new Map<string, string[]>();
  for (const [path, url] of Object.entries(FOUND)) {
    const match = /\/(music|sfx)\/([^/]+)\.[a-z0-9]+$/.exec(path);
    if (!match) continue;
    const key = match[1] === 'music' ? `music-${match[2]}` : match[2];
    byKey.set(key, [...(byKey.get(key) ?? []), url]);
  }
  return [...byKey].map(([key, urls]) => ({ key, urls }));
}

/** Where the music came from: the real stems, or the placeholders. */
export type MusicSource = 'files' | 'placeholder' | 'none';

/**
 * After loading: keep the music files if every stem arrived, otherwise put placeholder stems in
 * their place (all of them: stems must share one tempo and length to stay in sync). Returns where
 * the music came from. Without Web Audio there is no music at all.
 */
export function settleMusic(scene: Phaser.Scene): MusicSource {
  const cache = scene.cache.audio;
  if (STEMS.every((id) => cache.exists(stemKey(id)))) return 'files';
  const manager = scene.sound;
  if (!(manager instanceof Phaser.Sound.WebAudioSoundManager)) return 'none';
  const missing = STEMS.filter((id) => !cache.exists(stemKey(id)));
  const { rate, stems } = renderPlaceholderStems();
  for (const id of STEMS) {
    if (cache.exists(stemKey(id))) cache.remove(stemKey(id));
    const buffer = manager.context.createBuffer(1, stems[id].length, rate);
    buffer.getChannelData(0).set(stems[id]);
    cache.add(stemKey(id), buffer);
  }
  console.info(`[audio] Placeholder music in use: no ${missing.map((id) => `${id}`).join(', ')} stem file(s) in src/assets/audio/music.`);
  return 'placeholder';
}
