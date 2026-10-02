import type { Diarization, DiarizationSegment, DiarizationTurn } from "../types";

export function formatSpeakerTime(seconds: number): string {
  const time = Math.max(0, Math.floor(seconds));
  const s = String(time % 60).padStart(2, "0");
  const m = Math.floor(time / 60);
  return m < 60 ? `${m}:${s}` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${s}`;
}

function label(data: Diarization, ids: number[]): string {
  return ids.length
    ? ids.map((id) => data.speakers.find((speaker) => speaker.id === id)?.name.trim() || `Interlocutor ${id + 1}`).join(" + ")
    : "Não identificado";
}

function prefix(data: Diarization, segment: DiarizationSegment): string {
  return `[${formatSpeakerTime(segment.start)}] (${label(data, segment.speakerIds)})`;
}

export function renderDiarizedTranscript(data: Diarization): string {
  return data.segments.map((segment) => `${prefix(data, segment)} ${segment.text}`).join("\n\n");
}

/** Update only known turn headers, preserving all manually edited text. */
export function renameTranscriptSpeakers(text: string, previous: Diarization, next: Diarization): string {
  const replacements = new Map(previous.segments.map((segment) => [prefix(previous, segment), prefix(next, segment)]));
  // Longest prefix first also handles names that contain parentheses.
  const headers = [...replacements.keys()].sort((a, b) => b.length - a.length);
  return text.split("\n").map((line) => {
    const header = headers.find((candidate) => line.startsWith(`${candidate} `) || line === candidate);
    return header ? replacements.get(header)! + line.slice(header.length) : line;
  }).join("\n");
}

export function renderSelfTranscript(data: Diarization, transcript = renderDiarizedTranscript(data)): string {
  const self = new Set(data.speakers.filter((speaker) => speaker.isSelf).map((speaker) => speaker.id));
  // Overlapping speech cannot safely be attributed exclusively to the user.
  const headers = data.segments.map((segment) => ({
    header: prefix(data, segment),
    time: formatSpeakerTime(segment.start),
    mine: segment.speakerIds.length === 1 && self.has(segment.speakerIds[0]),
  })).sort((a, b) => b.header.length - a.header.length);
  const lines: string[] = [];
  let mine = false;
  for (const line of transcript.split("\n")) {
    const turn = headers.find(({ header }) => line.startsWith(`${header} `) || line === header);
    if (turn) {
      mine = turn.mine;
      if (mine) lines.push(`[${turn.time}]${line.slice(turn.header.length)}`);
    } else if (/^\[\d+:\d+(?::\d+)?\]/.test(line)) {
      mine = false;
    } else if (mine) lines.push(line);
  }
  return lines.join("\n").trim();
}

/** Prefer the longest portion without another speaker for voice identification. */
export function speakerSample(data: Diarization, id: number): DiarizationTurn | undefined {
  const clean: DiarizationTurn[] = [];
  const own = data.turns.filter((turn) => turn.speakerId === id);
  const others = data.turns.filter((turn) => turn.speakerId !== id);
  for (const turn of own) {
    let pieces = [turn];
    for (const other of others.filter((candidate) => candidate.start < turn.end && candidate.end > turn.start)) {
      pieces = pieces.flatMap((piece) => {
        if (other.end <= piece.start || other.start >= piece.end) return [piece];
        const remaining: DiarizationTurn[] = [];
        if (other.start > piece.start) remaining.push({ ...piece, end: other.start });
        if (other.end < piece.end) remaining.push({ ...piece, start: other.end });
        return remaining;
      });
    }
    clean.push(...pieces);
  }
  return (clean.length ? clean : own).sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
}
