// Preferências do gravador de reuniões compartilhadas entre o controle na
// nota (RichTextEditor) e o início automático via banner (AppContext).

export const AUTO_STOP_STORAGE_KEY = "titus-recorder-autostop-secs";

export const AUTO_STOP_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Sem parada automática" },
  { value: 120, label: "Parar após 2 min de silêncio" },
  { value: 300, label: "Parar após 5 min de silêncio" },
  { value: 600, label: "Parar após 10 min de silêncio" },
];

export function loadAutoStopSecs(): number {
  const raw = Number(localStorage.getItem(AUTO_STOP_STORAGE_KEY));
  return AUTO_STOP_OPTIONS.some((o) => o.value === raw) ? raw : 300;
}
