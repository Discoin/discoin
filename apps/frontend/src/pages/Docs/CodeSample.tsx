import { CopyButton } from "../../components/shared/CopyButton.jsx";

interface CodeSampleProps {
  title: string;
  code: string;
  label: string;
}

export function CodeSample({ title, code, label }: CodeSampleProps) {
  return (
    <div class="docs-code" role="group" aria-label={label}>
      <div class="docs-code__bar">
        <span class="docs-code__title">{title}</span>
        <CopyButton text={code} label={label} />
      </div>
      <pre class="docs-code__text">
        <code>{code}</code>
      </pre>
    </div>
  );
}
