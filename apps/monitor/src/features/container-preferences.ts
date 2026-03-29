type ContainerRow = {
  Names: string;
  Image: string;
};

type PreferredContainer = {
  name: string;
  image: string;
};

const PREFERRED_CONTAINERS: readonly PreferredContainer[] = [
  { name: "sglang_node_tf5", image: "scitrera/dgx-spark-sglang:0.5.9-t5" },
  { name: "sglang_node", image: "lmsysorg/sglang:spark" },
];

function firstContainerName(names: string): string {
  const first = names.trim().split(/\s+/)[0] ?? "";
  return first.startsWith("/") ? first.slice(1) : first;
}

function imageMatches(actual: string, expected: string): boolean {
  const a = actual.trim();
  const e = expected.trim();
  return a === e || a.startsWith(`${e}@`);
}

export function pickPreferredContainer(rows: readonly ContainerRow[]): string | null {
  for (const preferred of PREFERRED_CONTAINERS) {
    const exact = rows.find((row) => firstContainerName(row.Names) === preferred.name);
    if (exact) return preferred.name;
  }

  for (const preferred of PREFERRED_CONTAINERS) {
    const byImage = rows.find((row) => imageMatches(row.Image, preferred.image));
    if (byImage) return firstContainerName(byImage.Names);
  }

  return null;
}
