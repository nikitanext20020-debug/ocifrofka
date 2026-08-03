import snapshot from "@/data/bogorodsky-streets.json";

export type BogorodskyAddress = {
  settlement: string;
  settlementType: string;
  street: string;
  streetType: string;
};

export const BOGORODSKY_SNAPSHOT_METADATA = snapshot.metadata;
export const BOGORODSKY_SETTLEMENTS = snapshot.settlements;

const REQUIRED_SETTLEMENTS = [
  "Ногинск",
  "Старая Купавна",
  "Электроугли",
  "Мамонтово",
];

function normalize(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ")
    .trim();
}

function validateSnapshot() {
  if (!BOGORODSKY_SETTLEMENTS.length) {
    throw new Error("Локальный справочник адресов Богородского округа пуст.");
  }

  const pairs = new Set<string>();
  for (const settlement of BOGORODSKY_SETTLEMENTS) {
    if (!settlement.name.trim() || !settlement.type.trim() || !settlement.streets.length) {
      throw new Error("Локальный справочник адресов Богородского округа повреждён.");
    }

    for (const street of settlement.streets) {
      const key = [settlement.name, street.type, street.name].map(normalize).join("|");
      if (!street.name.trim() || !street.type.trim() || pairs.has(key)) {
        throw new Error("Локальный справочник адресов Богородского округа повреждён.");
      }
      pairs.add(key);
    }
  }

  const settlementNames = new Set(
    BOGORODSKY_SETTLEMENTS.map((settlement) => normalize(settlement.name)),
  );
  if (REQUIRED_SETTLEMENTS.some((name) => !settlementNames.has(normalize(name)))) {
    throw new Error("В локальном справочнике отсутствуют обязательные населённые пункты.");
  }
}

validateSnapshot();

export function selectBogorodskyAddress(sequence: number): BogorodskyAddress {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error("Некорректный номер строки для локального справочника адресов.");
  }

  const settlementIndex = sequence % BOGORODSKY_SETTLEMENTS.length;
  const settlement = BOGORODSKY_SETTLEMENTS[settlementIndex];
  const cycle = Math.floor(sequence / BOGORODSKY_SETTLEMENTS.length);
  const street = settlement.streets[cycle % settlement.streets.length];

  return {
    settlement: settlement.name,
    settlementType: settlement.type,
    street: street.name,
    streetType: street.type,
  };
}

export function formatBogorodskyAddress(address: BogorodskyAddress, sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error("Некорректный номер строки для локального справочника адресов.");
  }

  const house = 1 + ((sequence * 37) % 199);
  return `${address.settlementType} ${address.settlement}, ${address.streetType} ${address.street}, д. ${house}`;
}

export function isBogorodskyStreet(settlement: string, street: string) {
  const expectedSettlement = BOGORODSKY_SETTLEMENTS.find(
    (item) => normalize(item.name) === normalize(settlement),
  );
  return Boolean(
    expectedSettlement?.streets.some((item) => normalize(item.name) === normalize(street)),
  );
}
