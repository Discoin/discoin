import type { ComponentChildren } from "preact";
import "./StatList.scss";

export interface Stat {
  label: string;
  value: ComponentChildren;
}

export function StatList({ stats }: { stats: Stat[] }) {
  return (
    <dl class="stat-list">
      {stats.map((stat) => (
        <div key={stat.label} class="stat-list__item">
          <dt>{stat.label}</dt>
          <dd class="figure">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}
