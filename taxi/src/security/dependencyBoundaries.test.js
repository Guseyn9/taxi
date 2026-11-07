import merge from 'deepmerge'

test.each(['target', 'source'])('deepmerge treats a %s __proto__ key as own data', side => {
  const hostile = JSON.parse('{"__proto__":{"polluted":true},"nested":{"ok":1}}')
  const target = side === 'target' ? hostile : Object.create(null)
  const source = side === 'source' ? hostile : { nested: { next: 2 } }
  const result = merge(target, source)
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  expect(result.polluted).toBeUndefined()
  expect({}.polluted).toBeUndefined()
  expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true)
  expect(result.__proto__).toEqual({ polluted: true })
})

test('merge keeps nested arrays, symbols, custom merge and cloning behavior', () => {
  const symbol = Symbol('config')
  const target = { list: [{ n: 1 }], nested: { a: 1 }, [symbol]: 'retained' }
  const result = merge(target, { list: [{ n: 2 }], nested: { b: 2 } })
  expect(result).toEqual({ list: [{ n: 1 }, { n: 2 }], nested: { a: 1, b: 2 }, [symbol]: 'retained' })
  expect(result.list[0]).not.toBe(target.list[0])
  expect(merge.all([{ n: 1 }, { n: 2 }], { customMerge: key => key === 'n' ? (a, b) => a + b : undefined })).toEqual({ n: 2 })
  expect(merge({ list: [1] }, { list: [2] }, { arrayMerge: (_a, b) => b })).toEqual({ list: [2] })
  expect(merge({ nested: { a: 1 } }, { nested: { b: 2 } }, { customMerge: key => key === 'nested' ? (a, b) => ({ ...a, ...b, custom: true }) : undefined })).toEqual({ nested: { a: 1, b: 2, custom: true } })
})
