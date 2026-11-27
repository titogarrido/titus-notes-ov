export interface RecordingStatus {
  filename: string;
  noteId: string;
  elapsedSecs: number;
  systemAudio: boolean;
  micMuted: boolean;
  warning: string | null;
}

export interface RecordingAttachment {
  noteId: string;
  filename: string;
  micFilename?: string | null;
}

export function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}
