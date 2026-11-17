const HEX = "[0-9a-fA-F]";
const HYPHENATED = `${HEX}{8}-${HEX}{4}-${HEX}{4}-${HEX}{4}-${HEX}{12}`;
const ACCEPTED_FORMS = new RegExp(
  `^(?:${HYPHENATED}|\\{${HYPHENATED}\\}|urn:uuid:${HYPHENATED}|${HEX}{32})$`,
);
const DIGIT_GROUPS = /^(.{8})(.{4})(.{4})(.{4})(.{12})$/;

export function parseTransactionId(value: string): string | null {
  if (!ACCEPTED_FORMS.test(value)) return null;

  const digits = value
    .replace(/^urn:uuid:/, "")
    .replace(/[{}-]/g, "")
    .toLowerCase();

  return digits.replace(DIGIT_GROUPS, "$1-$2-$3-$4-$5");
}
