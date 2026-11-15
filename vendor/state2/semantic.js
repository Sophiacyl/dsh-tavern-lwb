// Based on LittleWhiteBox by biex; Apache-2.0 + attribution.
// Source: https://github.com/RT15548/LittleWhiteBox commit 707e03f2d7f75bb6588b29625b3bd61b6c4a7c5a.
// Modified for standalone verification: imports, strict boundaries and isolated guards.
export function generateSemantic(path, op, oldValue, newValue, delta, operandValue) {
    const p = String(path ?? '').replace(/\./g, ' > ');

    const fmt = (v) => {
        if (v === undefined) return '空';
        if (v === null) return 'null';
        try {
            return JSON.stringify(v);
        } catch {
            return String(v);
        }
    };

    switch (op) {
        case 'set':
            return oldValue === undefined
                ? `${p} 设为 ${fmt(newValue)}`
                : `${p} 从 ${fmt(oldValue)} 变为 ${fmt(newValue)}`;

        case 'inc': {
            const sign = (delta ?? 0) >= 0 ? '+' : '';
            return `${p} ${sign}${delta}（${fmt(oldValue)} → ${fmt(newValue)}）`;
        }

        case 'push': {
            const items = Array.isArray(operandValue) ? operandValue : [operandValue];
            return `${p} 加入 ${items.map(fmt).join('、')}`;
        }

        case 'pop': {
            const items = Array.isArray(operandValue) ? operandValue : [operandValue];
            return `${p} 移除 ${items.map(fmt).join('、')}`;
        }

        case 'del':
            return `${p} 被删除（原值 ${fmt(oldValue)}）`;

        default:
            return `${p} 操作 ${op}`;
    }
}
