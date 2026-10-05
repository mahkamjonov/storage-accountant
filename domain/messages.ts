// Foydalanuvchiga ko'rinadigan matnlar (o'zbekcha). Server ham, interfeys ham shu yerdan oladi.
import type { RuleError } from './rules.ts';
import type { Location, Movement, MovementType } from './types.ts';

export const TYPE_LABEL: Record<MovementType, string> = {
  received: 'Mahsulot keldi',
  to_uzum: "Uzumga jo'natdim",
  sold: 'Sotildi',
  returned: 'Qaytdi',
  written_off: "Brak / yo'qolgan",
  adjustment: 'Sanab tuzatish',
};

export const TYPE_HINT: Record<MovementType, string> = {
  received: 'Yetkazib beruvchidan omborimga',
  to_uzum: 'Omborimdan Uzum omboriga',
  sold: 'Uzumda xaridorga sotildi',
  returned: 'Uzumdan omborimga qaytdi',
  written_off: 'Buzilgan yoki topilmadi',
  adjustment: 'Sanab, haqiqiy sonni yozaman',
};

export const LOCATION_LABEL: Record<Location, string> = {
  own: 'Omborim',
  uzum: 'Uzum ombori',
};

/** "Omboringizda" / "Uzum omborida" */
const LOCATION_IN: Record<Location, string> = {
  own: 'Omboringizda',
  uzum: 'Uzum omborida',
};

/** Kamchilikni to'ldiradigan harakat. */
const REFILL_HINT: Record<Location, string> = {
  own: '"Mahsulot keldi"',
  uzum: `"Uzumga jo'natdim"`,
};

export function formatRuleError(error: RuleError): string {
  switch (error.code) {
    case 'INVALID_QUANTITY':
      return 'Sonni kiriting: 1 yoki undan katta butun son.';
    case 'INVALID_COUNT':
      return 'Sanagan soningizni kiriting: 0 yoki undan katta butun son.';
    case 'LOCATION_REQUIRED':
      return 'Qayerda ekanini tanlang: omborim yoki Uzum.';
    case 'NOT_ENOUGH': {
      const where = LOCATION_IN[error.location];
      if (error.available === 0) {
        return `${where} hozir bu mahsulot yo'q. Avval ${REFILL_HINT[error.location]}ni kiriting.`;
      }
      return `${where} faqat ${error.available} ta bor. Sonni ${error.available} tadan oshirmang yoki avval ${REFILL_HINT[error.location]}ni kiriting.`;
    }
    case 'NO_CHANGE':
      return `${LOCATION_IN[error.location]} hisob bo'yicha ham ${error.counted} ta. Hammasi to'g'ri, tuzatish shart emas.`;
    case 'ALREADY_VOIDED':
      return 'Bu yozuv allaqachon bekor qilingan.';
    case 'VOID_GOES_NEGATIVE':
      return (
        `Bu yozuvni bekor qilib bo'lmaydi. ${LOCATION_IN[error.location]} hozir ${error.available} ta bor, ` +
        `bekor qilinsa ${formatSigned(error.available - error.needed)} bo'lib qoladi. ` +
        `Avval shu mahsulotning keyingi yozuvlarini (masalan, jo'natish yoki sotuvni) bekor qiling.`
      );
  }
}

/** Manfiy sonni haqiqiy minus belgisi bilan yozadi: −5 */
export function formatSigned(n: number, withPlus = false): string {
  if (n < 0) return `−${Math.abs(n)}`;
  return withPlus && n > 0 ? `+${n}` : String(n);
}

/** Harakat nomi joy bilan: FBS sotuv/qaytarish alohida ko'rinadi. */
export function movementTitle(m: Pick<Movement, 'type' | 'location'>): string {
  if ((m.type === 'sold' || m.type === 'returned') && m.location === 'own') return `${TYPE_LABEL[m.type]} (FBS)`;
  return TYPE_LABEL[m.type];
}

/** Tarixda ko'rsatish uchun qisqa tavsif, masalan: "Omborim −5" yoki "Sanaldi: 45 ta". */
export function describeMovement(m: Movement): string {
  if (m.type === 'adjustment' && m.countedQuantity !== null && m.location) {
    return `${LOCATION_LABEL[m.location]}: sanaldi ${m.countedQuantity} ta`;
  }
  if (m.type === 'written_off' && m.location) return LOCATION_LABEL[m.location];
  return TYPE_HINT[m.type];
}
