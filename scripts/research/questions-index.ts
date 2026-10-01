/*
 * Builds research/QUESTIONS-INDEX.md: table of every question on the board,
 * its addressee and whether an answer block referencing it exists.
 *
 * Usage: `bun scripts/research/questions-index.ts`
 */

/** The text of the question board. */
const text = await Bun.file(new URL("../../research/_board/questions.md", import.meta.url)).text();
/** The board, line by line. */
const lines = text.split("\n");

/**
 * One question of the board.
 *
 * @example
 * ```ts
 * const q: Q = { id: "Q-1", to: "USER", line: 10, first: "What?" };
 * ```
 */
interface Q {
  /** The question id. */
  id: string;
  /** Who the question is for. */
  to: string;
  /** 1-based line of the heading. */
  line: number;
  /** The first line of the body. */
  first: string;
}
/** Every question found. */
const qs: Q[] = [];
/** Every answer heading found. */
const answers: string[] = [];

for (let i = 0; i < lines.length; i++) {
  const l = lines[i]!;
  const h = l.match(/^### (Q-[A-Z0-9]+-[0-9]+(?:\([a-z]\))?)\s*→\s*(.+)$/);
  if (h) {
    const body = lines.slice(i + 1).find((x) => x.trim() !== "") ?? "";
    qs.push({ id: h[1]!, to: h[2]!.trim(), line: i + 1, first: body });
    continue;
  }
  if (/^(\*\*A|### A )/.test(l)) answers.push(l);
}

/**
 * Tells whether a question has an answer.
 *
 * @param q - The question.
 * @returns `true` when an answer follows it directly or an answer heading names it.
 */
const answered = (q: Q) => {
  const idx = lines.findIndex((_, i) => i === q.line - 1);
  /* An answer directly below the question (before the next header). */
  for (let j = idx + 1; j < lines.length && !lines[j]!.startsWith("### Q-"); j++) {
    if (/^\*\*A/.test(lines[j]!)) return true;
  }
  const bare = q.id.replace(/\(.\)$/, "");
  return answers.some((a) => a.includes(q.id) || new RegExp(`${bare}(?![0-9(])`).test(a));
};

/**
 * A table-safe, shortened text.
 *
 * @param s - The text.
 * @returns The text without pipes and backticks, at most 160 characters.
 */
const short = (s: string) => s.replace(/\|/g, "\\|").replace(/`/g, "").slice(0, 160) + (s.length > 160 ? "…" : "");
/** The table rows. */
const rows = qs.map((q) => {
  const user = /USER/.test(q.to);
  return `| ${user ? "**" + q.id + "**" : q.id} | ${q.to} | ${answered(q) ? "есть ответ" : user ? "**ждёт пользователя**" : "без ответа"} | ${short(q.first)} | [L${q.line}](_board/questions.md#L${q.line}) |`;
});

const userCount = qs.filter((q) => /USER/.test(q.to)).length;
const out = `# Индекс всех вопросов доски (этап 1)

Сгенерировано скриптом \`scripts/research/questions-index.ts\` из \`research/_board/questions.md\`.
Всего вопросов: **${qs.length}**, из них адресовано пользователю (USER): **${userCount}** (выделены жирным).
Статус «есть ответ» — эвристика: под вопросом или в ответах агентов есть ссылка на его номер.
Сгруппированный список вопросов к пользователю: [QUESTIONS-FOR-USER.md](QUESTIONS-FOR-USER.md).

| Вопрос | Кому | Статус | Суть (начало) | Где |
|---|---|---|---|---|
${rows.join("\n")}
`;
await Bun.write(new URL("../../research/QUESTIONS-INDEX.md", import.meta.url), out);
console.log(qs.length, "questions,", userCount, "USER,", qs.filter(answered).length, "answered");
