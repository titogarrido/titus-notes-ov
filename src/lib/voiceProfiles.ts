import type { Database, Diarization, Person, VoiceSignature } from "../types";

export const VOICE_MODEL = "redimnet2-b6-1272aa38";
export function validVoiceSignature(value?: VoiceSignature | null): value is VoiceSignature {
  return !!value && value.model === VOICE_MODEL && Number.isFinite(value.duration) && value.duration >= 2 && value.duration <= 6.01
    && value.embedding.length === 192 && value.embedding.every(Number.isFinite)
    && value.embedding.reduce((n, v) => n + v * v, 0) > 0.001;
}
function normalized(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((n, v) => n + v * v, 0));
  return norm > 0.000001 ? vector.map((v) => v / norm) : [];
}

/** Scores are cosine similarity, not probabilities. Defaults are deliberately
 * conservative; uncertain matches never become enrollment samples automatically. */
export function matchVoiceProfiles(data: Diarization, people: Person[]): Diarization {
  const profiles = people.flatMap((person) => {
    const profile = person.voiceProfile;
    if (profile?.model !== VOICE_MODEL) return [];
    const samples = profile.samples.filter(validVoiceSignature).slice(-5);
    if (!samples.length) return [];
    const centroid = normalized(samples.reduce((sum, sample) => normalized(sample.embedding).map((v, i) => sum[i] + v), Array(192).fill(0)));
    return centroid.length ? [{ person, centroid }] : [];
  });
  const speakers = data.speakers.map((speaker) => {
    if (!validVoiceSignature(speaker.voiceSignature)) return speaker;
    const vector = normalized(speaker.voiceSignature.embedding);
    const candidates = profiles.map(({ person, centroid }) => ({ person, score: vector.reduce((n, v, i) => n + v * centroid[i], 0) })).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best || best.score < 0.55) return speaker;
    const automatic = best.score >= 0.80 && best.score - (candidates[1]?.score ?? 0) >= 0.10 && speaker.voiceSignature.duration >= 3;
    return { ...speaker,
      ...(automatic ? { name: best.person.name, personId: best.person.id, isSelf: !!best.person.voiceProfile?.isSelf } : {}),
      voiceMatch: { personId: best.person.id, similarity: best.score, status: automatic ? "automatic" as const : "suggested" as const },
    };
  });
  // Simultaneous clusters cannot both be the same person. Require human review.
  return { ...data, speakers: speakers.map((speaker) => {
    if (speaker.voiceMatch?.status !== "automatic") return speaker;
    const collision = speakers.some((other) => other.id !== speaker.id && other.voiceMatch?.personId === speaker.voiceMatch!.personId
      && data.turns.some((a) => a.speakerId === speaker.id && data.turns.some((b) => b.speakerId === other.id && a.start < b.end && b.start < a.end)));
    return collision ? { ...speaker, name: `Interlocutor ${speaker.id + 1}`, personId: null, isSelf: false, voiceMatch: { ...speaker.voiceMatch, status: "suggested" as const } } : speaker;
  }) };
}

/** Fresh-state enrollment: ignore results after note/audio/person replacement.
 * One anchor per recording/person, at most five verified recordings. */
export function enrollVoiceProfile(db: Database, noteId: string, filename: string, speakerId: number, personId: string, signature: VoiceSignature, now: string): Database {
  if (!validVoiceSignature(signature)) throw new Error("Perfil de voz inválido.");
  const note = db.notes.find((n) => n.id === noteId && n.audioFile === filename && n.diarization?.filename === filename);
  const speaker = note?.diarization?.speakers.find((s) => s.id === speakerId && s.personId === personId);
  if (!note || !speaker || !db.people.some((p) => p.id === personId)) return db;
  return { ...db,
    people: db.people.map((person) => {
      if (person.id !== personId) return speaker.isSelf && person.voiceProfile?.isSelf ? { ...person, voiceProfile: { ...person.voiceProfile, isSelf: false } } : person;
      const old = person.voiceProfile?.model === signature.model ? person.voiceProfile.samples.filter(validVoiceSignature) : [];
      return { ...person, voiceProfile: { model: signature.model, isSelf: speaker.isSelf, updatedAt: now,
        samples: [...old.filter((s) => s.filename !== filename), { ...signature, sourceNoteId: noteId, filename, createdAt: now }].slice(-5),
      } };
    }),
    notes: db.notes.map((n) => n.id === noteId ? { ...n, diarization: { ...n.diarization!, speakers: n.diarization!.speakers.map((s) => s.id === speakerId ? { ...s, voiceSignature: signature, voiceMatch: null } : s) } } : n),
  };
}
