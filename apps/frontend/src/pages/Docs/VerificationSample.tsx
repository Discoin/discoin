import { useState } from "preact/hooks";
import {
  RadioGroup,
  type RadioOption,
} from "../../components/shared/RadioGroup.jsx";
import { CodeSample } from "./CodeSample.jsx";

const NODE_SAMPLE = `import { createHmac, timingSafeEqual } from "node:crypto";

export function isSignedByDiscoin(secret, header, rawBody) {
  const expected = Buffer.from(
    createHmac("sha256", secret).update(rawBody).digest("hex"),
  );
  const given = Buffer.from(header);

  return given.length === expected.length && timingSafeEqual(given, expected);
}`;

const PYTHON_SAMPLE = `import hashlib
import hmac


def is_signed_by_discoin(secret: str, header: str, raw_body: bytes) -> bool:
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()

    return hmac.compare_digest(expected.encode(), header.encode())`;

const SAMPLES = {
  node: { label: "Node.js", code: NODE_SAMPLE },
  python: { label: "Python", code: PYTHON_SAMPLE },
};

type Language = keyof typeof SAMPLES;

const LANGUAGE_OPTIONS: RadioOption<Language>[] = [
  { value: "node", label: SAMPLES.node.label },
  { value: "python", label: SAMPLES.python.label },
];

export function VerificationSample() {
  const [language, setLanguage] = useState<Language>("node");
  const sample = SAMPLES[language];

  return (
    <div class="docs-verification">
      <RadioGroup<Language>
        legend="Language"
        options={LANGUAGE_OPTIONS}
        value={language}
        disabled={false}
        onChange={setLanguage}
      />
      <CodeSample
        key={language}
        title={sample.label}
        code={sample.code}
        label={`${sample.label} signature check`}
      />
    </div>
  );
}
