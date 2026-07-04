// Templates de prompt editáveis pelo usuário (Configurações → IA → Prompts).
//
// Cada template usa placeholders no formato {{chave}} que são substituídos em
// tempo de geração pelos dados dinâmicos (notas, transcrição, idioma, etc.).
// Blocos opcionais (transcrição, sumários, etc.) já vêm com quebras de linha
// embutidas quando presentes e vazios caso contrário — por isso ficam colados
// ao texto no template.

export type PromptKind = "summary" | "actionItems" | "profile";

export const DEFAULT_PROMPTS: Record<PromptKind, string> = {
  summary: `Você é um assistente que gera sumários de reuniões.
Idioma da resposta: {{idioma}}.
Formate a resposta em Markdown, usando cabeçalhos "##" para cada seção e bullet points quando fizer sentido.
Não use tabelas em Markdown — prefira listas com bullet points.
Seja objetivo, mantenha nomes próprios e datas.

Template "{{nomeTemplate}}" — {{descricaoTemplate}}.
Seções obrigatórias (use exatamente estes títulos):
{{secoes}}

Título da nota: {{tituloNota}}

Anotações da reunião:
"""
{{notas}}
"""{{transcricao}}

Gere o sumário agora, somente em Markdown, sem comentários adicionais.`,

  actionItems: `Você extrai itens de ação (tarefas / próximos passos) de reuniões.
Idioma dos títulos: {{idioma}}.
Data de hoje: {{hoje}} (use para resolver datas relativas como "amanhã", "sexta", "semana que vem").

VOCÊ (o usuário) é referido nas reuniões por: {{seusNomes}}.{{responsabilidades}}

Responda APENAS com um array JSON válido, sem texto antes ou depois, sem cercas de código.
Cada elemento tem exatamente estas chaves:
  - "title": string — a tarefa no infinitivo, objetiva e acionável.
  - "assignee": string ou null — o responsável. Se a pessoa estiver na lista de pessoas conhecidas, use o nome EXATO de lá; caso contrário use o nome citado ou null.
  - "due": string ou null — data de vencimento no formato "yyyy-mm-dd", apenas se houver prazo claro; senão null.
  - "owner": "me", "other" ou null. Use "me" quando a tarefa for SUA: atribuída a você por um dos seus nomes ({{seusNomes}}), OU assumida por você em primeira pessoa ("eu vou", "deixa comigo", "fico de"), especialmente se o compromisso aparecer nos trechos ditos por VOCÊ. Se a transcrição estiver rotulada com "(Você)" e "(Outros)", trate as falas marcadas "(Você)" como suas e as "(Outros)" como de terceiros. Use "other" quando for claramente de outra pessoa. Use null se não der pra saber.

Inclua somente compromissos reais e acionáveis. Não invente tarefas. Se não houver nenhuma, responda [].{{instrucoesExtras}}

Título da nota: {{tituloNota}}

Anotações da reunião:
"""
{{notas}}
"""{{transcricao}}{{suasFalas}}{{sumarios}}{{pessoas}}

Agora responda somente com o array JSON.`,

  profile: `Você é um analista de relacionamento profissional. Sua tarefa é gerar um PERFIL DESCRITIVO de uma pessoa, com base em sumários de reuniões em que ela participou.

Idioma da resposta: {{idioma}}.
Formate em Markdown, usando cabeçalhos "##" para cada seção e bullet points ("- ") quando fizer sentido. Não use tabelas em Markdown — prefira listas com bullet points. Seja factual, evite suposições e atribua afirmações às fontes quando possível (ex.: "Em 12/03, demonstrou interesse por X").

IMPORTANTE: NÃO use tabelas em Markdown (nada de "|" ou linhas com "---"). Use apenas parágrafos e listas com bullets.

Pessoa: {{nome}}
Cargo: {{cargo}}
Departamento: {{departamento}}
E-mail: {{email}}

Seções obrigatórias (use exatamente estes títulos):
## Resumo executivo
## Áreas de interesse e responsabilidades
## Estilo de trabalho e comunicação
## Tópicos recorrentes e prioridades
## Relacionamentos-chave mencionados
## Pontos de atenção / próximos passos sugeridos

Sumários disponíveis ({{totalFontes}} no total, todos provenientes de notas em que esta pessoa participou):

{{fontes}}

Gere o perfil agora, somente em Markdown, sem comentários adicionais. Se alguma seção não tiver evidências suficientes nas fontes, escreva "Sem evidências suficientes nas notas." em vez de inventar.`,
};

export interface PromptMeta {
  /** Rótulo curto exibido na UI. */
  label: string;
  /** Descrição de quando o prompt é usado. */
  description: string;
  /** Placeholders disponíveis (sem as chaves) e o que representam. */
  placeholders: { token: string; desc: string }[];
}

export const PROMPT_META: Record<PromptKind, PromptMeta> = {
  summary: {
    label: "Sumários",
    description: "Gera o sumário de uma nota a partir de um template de seções.",
    placeholders: [
      { token: "idioma", desc: "idioma da resposta" },
      { token: "nomeTemplate", desc: "nome do template escolhido" },
      { token: "descricaoTemplate", desc: "descrição do template" },
      { token: "secoes", desc: "lista numerada das seções" },
      { token: "tituloNota", desc: "título da nota" },
      { token: "notas", desc: "conteúdo digitado da nota" },
      { token: "transcricao", desc: "bloco da transcrição (vazio se não houver)" },
    ],
  },
  actionItems: {
    label: "Atividades (itens de ação)",
    description: "Extrai tarefas/próximos passos da nota em formato JSON.",
    placeholders: [
      { token: "idioma", desc: "idioma dos títulos" },
      { token: "hoje", desc: "data de hoje (yyyy-mm-dd)" },
      { token: "seusNomes", desc: "seus nomes/apelidos" },
      { token: "responsabilidades", desc: "suas áreas (vazio se não houver)" },
      { token: "instrucoesExtras", desc: "instruções livres do usuário (vazio se não houver)" },
      { token: "tituloNota", desc: "título da nota" },
      { token: "notas", desc: "conteúdo digitado da nota" },
      { token: "transcricao", desc: "bloco da transcrição (vazio se não houver)" },
      { token: "suasFalas", desc: "trechos do seu microfone (vazio se não houver)" },
      { token: "sumarios", desc: "sumários já gerados (vazio se não houver)" },
      { token: "pessoas", desc: "lista de pessoas conhecidas (vazio se não houver)" },
    ],
  },
  profile: {
    label: "Perfil de pessoas",
    description: "Gera um perfil descritivo agregando sumários das notas da pessoa.",
    placeholders: [
      { token: "idioma", desc: "idioma da resposta" },
      { token: "nome", desc: "nome da pessoa" },
      { token: "cargo", desc: "cargo da pessoa" },
      { token: "departamento", desc: "departamento da pessoa" },
      { token: "email", desc: "e-mail da pessoa" },
      { token: "totalFontes", desc: "quantidade de sumários usados" },
      { token: "fontes", desc: "blocos com os sumários fonte" },
    ],
  },
};

/** Substitui {{chave}} pelos valores fornecidos; chaves ausentes viram "". */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : "",
  );
}

/** Retorna o template customizado (se houver e não vazio) ou o padrão. */
export function resolvePromptTemplate(
  kind: PromptKind,
  custom?: string | null,
): string {
  return custom && custom.trim() ? custom : DEFAULT_PROMPTS[kind];
}
