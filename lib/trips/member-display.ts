export type MemberIdentity = {
  id: string;
  userId: string;
  displayName: string;
};

export type MemberDisplay = {
  name: string;
  tag: string | null;
  marker: number;
};

function normalizedName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function hashUserId(value: string) {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function shortTag(userId: string, used: Set<string>) {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let value = hashUserId(userId) % (alphabet.length * alphabet.length);
  let tag = `${alphabet[Math.floor(value / alphabet.length)]}${alphabet[value % alphabet.length]}`;
  while (used.has(tag)) {
    value = (value + 1) % (alphabet.length * alphabet.length);
    tag = `${alphabet[Math.floor(value / alphabet.length)]}${alphabet[value % alphabet.length]}`;
  }
  used.add(tag);
  return tag;
}

export function getMemberDisplays(members: MemberIdentity[]) {
  const groups = new Map<string, MemberIdentity[]>();
  for (const member of members) {
    const key = normalizedName(member.displayName);
    const group = groups.get(key) ?? [];
    group.push(member);
    groups.set(key, group);
  }

  const displays = new Map<string, MemberDisplay>();
  for (const group of groups.values()) {
    const duplicate = group.length > 1;
    const used = new Set<string>();
    for (const member of [...group].sort((a, b) =>
      a.userId.localeCompare(b.userId),
    )) {
      const hash = hashUserId(member.userId);
      displays.set(member.id, {
        name: member.displayName,
        tag: duplicate ? shortTag(member.userId, used) : null,
        marker: hash % 4,
      });
    }
  }
  return displays;
}
