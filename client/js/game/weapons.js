// ============================================================
// Weapon catalog
// ============================================================

export const WEAPONS = {
    pistol: {
      name: 'PISTOL',
      magSize: 12,
      reserveMax: Infinity,   // starter weapon has infinite reserve
      damage: 1.3,
      fireRate: 0.16,
      reloadTime: 1.0,
      spread: 0.04,
      bulletSpeed: 400,
      bullets: 1,
      recoil: 20,
      knockback: 8,
      sound: 'pistol',
      auto: false,
    },
    shotgun: {
      name: 'SHOTGUN',
      magSize: 6,
      reserveMax: Infinity,
      damage: 1.0,
      fireRate: 0.7,
      reloadTime: 1.6,
      spread: 0.28,
      bulletSpeed: 340,
      bullets: 8,
      recoil: 80,
      knockback: 30,
      sound: 'shotgun',
      auto: false,
    },
    smg: {
      name: 'SMG',
      magSize: 30,
      reserveMax: Infinity,
      damage: 0.75,
      fireRate: 0.075,
      reloadTime: 1.4,
      spread: 0.09,
      bulletSpeed: 420,
      bullets: 1,
      recoil: 12,
      knockback: 5,
      sound: 'smg',
      auto: true,
    },
    rifle: {
      name: 'RIFLE',
      magSize: 8,
      reserveMax: Infinity,
      damage: 3.2,
      fireRate: 0.5,
      reloadTime: 1.8,
      spread: 0.01,
      bulletSpeed: 550,
      bullets: 1,
      recoil: 45,
      knockback: 20,
      pierce: 2,
      sound: 'rifle',
      auto: false,
    },
    lmg: {
      name: 'LMG',
      magSize: 80,
      reserveMax: Infinity,
      damage: 1.1,
      fireRate: 0.075,
      reloadTime: 2.6,
      spread: 0.14,
      bulletSpeed: 400,
      bullets: 1,
      recoil: 15,
      knockback: 6,
      slowMove: 0.55,
      sound: 'lmg',
      auto: true,
    },
  };
  
  export function createWeaponInstance(type) {
    const def = WEAPONS[type];
    if (!def) throw new Error('Unknown weapon: ' + type);
    return {
      type,
      def,
      mag: def.magSize,
      reserve: def.reserveMax === Infinity ? Infinity : Math.min(def.reserveMax, def.magSize * 3),
    };
  }