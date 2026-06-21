/** Minimum size to count as a user-visible volume (filters EFI/recovery stubs). */
const MIN_DISK_BYTES = 512 * 1024 * 1024;

export interface DiskInfo {
  name: string;
  mount: string;
  total: number;
  available: number;
}

function isRecoveryMount(mount: string): boolean {
  const m = mount.toLowerCase().replace(/\\/g, "/");
  return (
    m.includes("recovery") ||
    m.endsWith("/recovery") ||
    m === "/boot/efi" ||
    m.endsWith(":/efi")
  );
}

/** Disks worth showing in the UI — one bar per real volume, no empty placeholders. */
export function displayDisks(disks: DiskInfo[]): DiskInfo[] {
  const valid = disks.filter((d) => d.total > 0 && !isRecoveryMount(d.mount));
  const significant = valid.filter((d) => d.total >= MIN_DISK_BYTES);
  let pool = significant.length > 0 ? significant : valid;

  // macOS APFS: user data lives on Data volume; root is a small snapshot.
  if (pool.some((d) => d.mount === "/System/Volumes/Data")) {
    pool = pool.filter((d) => d.mount !== "/" && !d.mount.startsWith("/private/var"));
  }

  const seen = new Set<string>();
  const unique = pool.filter((d) => {
    if (seen.has(d.mount)) return false;
    seen.add(d.mount);
    return true;
  });

  unique.sort((a, b) => b.total - a.total);
  return unique.slice(0, 4);
}

/** Primary disk for compact views (widget strip). */
export function primaryDisk(disks: DiskInfo[]): DiskInfo | undefined {
  return displayDisks(disks)[0];
}
