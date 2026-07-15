type SettlementType = "город" | "посёлок городского типа" | "посёлок" | "деревня" | "село";

type Settlement = {
  name: string;
  type: SettlementType;
};

const SETTLEMENTS: Settlement[] = [
  { name: "Ногинск", type: "город" },
  { name: "Старая Купавна", type: "город" },
  { name: "Электроугли", type: "город" },
  { name: "Обухово", type: "посёлок городского типа" },
  { name: "имени Воровского", type: "посёлок городского типа" },
  { name: "2-й Бисеровский участок", type: "посёлок" },
  { name: "Аборино", type: "деревня" },
  { name: "Авдотьино", type: "деревня" },
  { name: "Аксёно-Бутырки", type: "деревня" },
  { name: "Алексеевка", type: "деревня" },
  { name: "Афанасово-1", type: "деревня" },
  { name: "Балобаново", type: "село" },
  { name: "Бездедово", type: "деревня" },
  { name: "Белая", type: "деревня" },
  { name: "Берёзовый Мостик", type: "деревня" },
  { name: "Бисерово", type: "село" },
  { name: "Богослово", type: "село" },
  { name: "Боково", type: "деревня" },
  { name: "Большое Буньково", type: "деревня" },
  { name: "Борилово", type: "деревня" },
  { name: "Боровково", type: "деревня" },
  { name: "Булгаково", type: "деревня" },
  { name: "Вишняково", type: "деревня" },
  { name: "Воскресенское", type: "село" },
  { name: "Гаврилово", type: "деревня" },
  { name: "Горбуша", type: "посёлок" },
  { name: "Горки", type: "деревня" },
  { name: "Громково", type: "деревня" },
  { name: "Дядькино", type: "деревня" },
  { name: "Ельня", type: "деревня" },
  { name: "Жилино", type: "деревня" },
  { name: "Загорново", type: "деревня" },
  { name: "Затишье", type: "посёлок" },
  { name: "Зелёный", type: "посёлок" },
  { name: "Зубцово", type: "деревня" },
  { name: "Ивашево", type: "деревня" },
  { name: "Исаково", type: "деревня" },
  { name: "Кабаново", type: "деревня" },
  { name: "Калитино", type: "деревня" },
  { name: "Каменки-Дранишниково", type: "деревня" },
  { name: "Карабаново", type: "деревня" },
  { name: "Караваево", type: "деревня" },
  { name: "Кашино", type: "деревня" },
  { name: "Клюшниково", type: "деревня" },
  { name: "Колонтаево", type: "деревня" },
  { name: "Колышкино Болото", type: "посёлок" },
  { name: "Кролики", type: "деревня" },
  { name: "Кудиново", type: "село" },
  { name: "Мамонтово", type: "село" },
  { name: "Марьино", type: "деревня" },
  { name: "Марьино-2", type: "деревня" },
  { name: "Марьино-3", type: "деревня" },
  { name: "Меленки", type: "деревня" },
  { name: "Мишуково", type: "деревня" },
  { name: "Молзино", type: "деревня" },
  { name: "Новая Купавна", type: "деревня" },
  { name: "Ново", type: "деревня" },
  { name: "Новое Подвязново", type: "деревня" },
  { name: "Новосергиево", type: "село" },
  { name: "Новостройка", type: "посёлок" },
  { name: "Новые Псарьки", type: "деревня" },
  { name: "Оселок", type: "деревня" },
  { name: "Пашуково", type: "деревня" },
  { name: "Пешково", type: "деревня" },
  { name: "Починки", type: "деревня" },
  { name: "Пятково", type: "деревня" },
  { name: "Радиоцентра-9", type: "посёлок" },
  { name: "Рыбхоз", type: "посёлок" },
  { name: "Следово", type: "деревня" },
  { name: "Соколово", type: "деревня" },
  { name: "Старые Псарьки", type: "деревня" },
  { name: "Стромынь", type: "село" },
  { name: "Стулово", type: "деревня" },
  { name: "Тимково", type: "деревня" },
  { name: "Тимохово", type: "деревня" },
  { name: "Турбазы «Боровое»", type: "посёлок" },
  { name: "Черепково", type: "деревня" },
  { name: "Черново", type: "деревня" },
  { name: "Шульгино", type: "деревня" },
  { name: "Щекавцево", type: "деревня" },
  { name: "Щемилово", type: "деревня" },
  { name: "Ямкино", type: "село" },
];

const TYPE_ABBREVIATIONS: Record<SettlementType, string> = {
  город: "г.",
  "посёлок городского типа": "пгт.",
  посёлок: "п.",
  деревня: "д.",
  село: "с.",
};

type Word = {
  value: string;
  start: number;
  end: number;
};

export type AddressCorrection = {
  value: string;
  changed: boolean;
  original: string;
  settlement: string | null;
  confidence: number | null;
};

function normalize(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[aceopxykmtbh]/g, (letter) => ({
      a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у",
      k: "к", m: "м", t: "т", b: "в", h: "н",
    })[letter] ?? letter)
    .replace(/[«»"'.,()[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string): Word[] {
  return Array.from(value.matchAll(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu), (match) => ({
    value: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function jaroSimilarity(left: string, right: string) {
  if (left === right) return 1;
  if (!left.length || !right.length) return 0;

  const range = Math.max(Math.floor(Math.max(left.length, right.length) / 2) - 1, 0);
  const leftMatches = Array<boolean>(left.length).fill(false);
  const rightMatches = Array<boolean>(right.length).fill(false);
  let matches = 0;

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const from = Math.max(0, leftIndex - range);
    const to = Math.min(leftIndex + range + 1, right.length);
    for (let rightIndex = from; rightIndex < to; rightIndex += 1) {
      if (rightMatches[rightIndex] || left[leftIndex] !== right[rightIndex]) continue;
      leftMatches[leftIndex] = true;
      rightMatches[rightIndex] = true;
      matches += 1;
      break;
    }
  }

  if (matches === 0) return 0;
  const matchedLeft = Array.from(left).filter((_, index) => leftMatches[index]);
  const matchedRight = Array.from(right).filter((_, index) => rightMatches[index]);
  const transpositions = matchedLeft.reduce(
    (count, letter, index) => count + (letter === matchedRight[index] ? 0 : 1),
    0,
  ) / 2;

  return (
    matches / left.length
    + matches / right.length
    + (matches - transpositions) / matches
  ) / 3;
}

function similarity(left: string, right: string) {
  const normalizedLeft = normalize(left).replaceAll(" ", "");
  const normalizedRight = normalize(right).replaceAll(" ", "");
  const jaro = jaroSimilarity(normalizedLeft, normalizedRight);
  let sharedPrefix = 0;
  while (
    sharedPrefix < Math.min(4, normalizedLeft.length, normalizedRight.length)
    && normalizedLeft[sharedPrefix] === normalizedRight[sharedPrefix]
  ) {
    sharedPrefix += 1;
  }
  return jaro + sharedPrefix * 0.1 * (1 - jaro);
}

function canonicalPrefix(type: SettlementType) {
  return TYPE_ABBREVIATIONS[type];
}

function findPrefix(address: string, settlementStart: number) {
  const before = address.slice(0, settlementStart);
  const match = before.match(/(?:^|\s|,)((?:г(?:ород)?|д(?:еревня)?|с(?:ело)?|п(?:гт|ос[её]лок)?|л)\s*[.,]?\s*)$/iu);
  if (!match || match.index === undefined) return null;
  const relativeStart = match.index + match[0].indexOf(match[1]);
  return { start: relativeStart, end: before.length, value: match[1] };
}

export function correctBogorodskyAddress(address: string): AddressCorrection {
  const original = address.trim();
  if (!original || original === "-") {
    return { value: original || "-", changed: false, original, settlement: null, confidence: null };
  }

  const addressWords = words(original);
  const ranked: Array<{
    settlement: Settlement;
    score: number;
    start: number;
    end: number;
    source: string;
  }> = [];

  for (const settlement of SETTLEMENTS) {
    const wordCount = words(settlement.name).length;
    for (let index = 0; index <= addressWords.length - wordCount; index += 1) {
      const window = addressWords.slice(index, index + wordCount);
      const start = window[0].start;
      const end = window.at(-1)?.end ?? start;
      const source = original.slice(start, end);
      ranked.push({ settlement, score: similarity(source, settlement.name), start, end, source });
    }
  }

  ranked.sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const secondDifferentSettlement = ranked.find(
    (candidate) => candidate.settlement.name !== best?.settlement.name,
  );
  if (!best) {
    return { value: original, changed: false, original, settlement: null, confidence: null };
  }

  const exact = normalize(best.source) === normalize(best.settlement.name);
  const margin = best.score - (secondDifferentSettlement?.score ?? 0);
  const confidentlyMatched = exact || (best.score >= 0.86 && margin >= 0.04 && normalize(best.source).length >= 4);
  if (!confidentlyMatched) {
    return { value: original, changed: false, original, settlement: null, confidence: best.score };
  }

  const prefix = findPrefix(original, best.start);
  const before = prefix ? original.slice(0, prefix.start) : original.slice(0, best.start);
  const replacement = `${prefix ? `${canonicalPrefix(best.settlement.type)} ` : ""}${best.settlement.name}`;
  const value = `${before}${replacement}${original.slice(best.end)}`;

  return {
    value,
    changed: value !== original,
    original,
    settlement: best.settlement.name,
    confidence: best.score,
  };
}
