/** Data-only arithmetic. Never compile server data as JavaScript. */
type Node = {
    kind: 'number';
    value: number;
} | {
    kind: 'variable';
    name: string;
} | {
    kind: 'unary';
    op: string;
    value: Node;
} | {
    kind: 'binary';
    op: string;
    left: Node;
    right: Node;
} | {
    kind: 'call';
    name: string;
    args: Node[];
};
const functions: Record<string, (...args: number[]) => number> = Object.assign(Object.create(null), {
    'Math.min': Math.min, 'Math.max': Math.max, 'Math.abs': Math.abs,
    'Math.ceil': Math.ceil, 'Math.floor': Math.floor, 'Math.round': Math.round, 'Math.trunc': Math.trunc,
});
const unaryFunctions = new Set(['Math.abs', 'Math.ceil', 'Math.floor', 'Math.round', 'Math.trunc']);
const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
export function priceNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string' && numeric.test(value.trim())) {
        const result = Number(value);
        if (Number.isFinite(result))
            return result;
    }
    throw new Error('Invalid numeric price parameter');
}
function parse(source: string): Node {
    if (typeof source !== 'string' || !source.trim() || source.length > 4096)
        throw new Error('Invalid formula');
    const tokens = source.match(/(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?|\*\*|[+\-*/%(),]|\S/gi) || [];
    if (tokens.length > 1024)
        throw new Error('Formula too complex');
    let offset = 0;
    let depth = 0;
    const peek = () => tokens[offset];
    const take = () => tokens[offset++];
    function atom(): Node {
        if (++depth > 64)
            throw new Error('Formula too deep');
        let result: Node;
        const token = take();
        if (token === '(') {
            result = expression(0);
            if (take() !== ')')
                throw new Error('Unclosed formula');
        }
        else if (token === '+' || token === '-') {
            result = { kind: 'unary', op: token, value: expression(3) };
        }
        else if (token && numeric.test(token)) {
            result = { kind: 'number', value: priceNumber(token) };
        }
        else if (token && /^[A-Za-z_]\w*$/.test(token) && !forbidden.has(token)) {
            result = { kind: 'variable', name: token };
        }
        else if (token && own(functions, token)) {
            if (take() !== '(')
                throw new Error('Expected numeric function arguments');
            const args: Node[] = [];
            if (peek() !== ')')
                do {
                    args.push(expression(0));
                    if (args.length > 16)
                        throw new Error('Too many arguments');
                    if (peek() !== ',')
                        break;
                    take();
                } while (true);
            if (take() !== ')' || !args.length || (unaryFunctions.has(token) && args.length !== 1))
                throw new Error('Invalid arguments');
            result = { kind: 'call', name: token, args };
        }
        else
            throw new Error('Unsupported formula token');
        depth--;
        return result;
    }
    function expression(minimum: number): Node {
        let left = atom();
        while (true) {
            const op = peek();
            const precedence = op === '**' ? 4 : ['*', '/', '%'].includes(op) ? 2 : ['+', '-'].includes(op) ? 1 : 0;
            if (!precedence || precedence < minimum)
                return left;
            take();
            const right = expression(op === '**' ? precedence : precedence + 1);
            left = { kind: 'binary', op, left, right };
        }
    }
    const node = expression(0);
    if (offset !== tokens.length)
        throw new Error('Trailing formula input');
    return node;
}
function variable(name: string, options: Readonly<Record<string, unknown>>): number {
    if (forbidden.has(name) || !own(options, name))
        throw new Error('Unknown price parameter');
    // An explicitly missing optional numeric value has always meant zero.
    return options[name] === undefined || options[name] === null ? 0 : priceNumber(options[name]);
}
export function evaluateArithmetic(source: string, options: Readonly<Record<string, unknown>> = {}): number {
    const walk = (node: Node): number => {
        let value: number;
        switch (node.kind) {
            case 'number': return node.value;
            case 'variable': return variable(node.name, options);
            case 'unary':
                value = (node.op === '-' ? -1 : 1) * walk(node.value);
                break;
            case 'call':
                value = functions[node.name](...node.args.map(walk));
                break;
            case 'binary': {
                const left = walk(node.left), right = walk(node.right);
                switch (node.op) {
                    case '+':
                        value = left + right;
                        break;
                    case '-':
                        value = left - right;
                        break;
                    case '*':
                        value = left * right;
                        break;
                    case '/':
                        value = left / right;
                        break;
                    case '%':
                        value = left % right;
                        break;
                    case '**':
                        value = left ** right;
                        break;
                    default: throw new Error('Unsupported arithmetic');
                }
            }
        }
        if (!Number.isFinite(value))
            throw new Error('Non-finite formula result');
        return value;
    };
    return walk(parse(source));
}
export function displayArithmetic(source: string, options: Readonly<Record<string, unknown>>): string {
    parse(source);
    return source.replace(/(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?/gi, name => {
        if (numeric.test(name))
            return name;
        if (own(functions, name))
            return name;
        if (own(options, name) && options[name] === '?')
            return '?';
        return String(Math.trunc(variable(name, options)));
    });
}
