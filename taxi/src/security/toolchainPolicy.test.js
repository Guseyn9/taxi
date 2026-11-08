import fs from 'fs'
import path from 'path'
import { Linter } from 'eslint'
import * as tsParser from '@typescript-eslint/parser'
import hooks from 'eslint-plugin-react-hooks'

const root = path.resolve(__dirname, '../..')
function checkHooks(source, filename = 'Example.tsx') {
  const linter = new Linter()
  linter.defineParser('typescript', tsParser)
  linter.defineRule('react-hooks/rules-of-hooks', hooks.rules['rules-of-hooks'])
  return linter.verify(source, {
    parser: 'typescript',
    parserOptions: { ecmaVersion: 2021, sourceType: 'module', ecmaFeatures: { jsx: true } },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  }, { filename })
}

test.each([
  'src/components/modals/CardModal.tsx',
  'src/pages/Order/index.tsx',
  'src/pages/Passenger/VotingForm.tsx',
])('hook analysis understands optional chains in %s', filename => {
  expect(checkHooks(fs.readFileSync(path.join(root, filename), 'utf8'), filename)).toEqual([])
})

test('hook analysis still rejects a hook under a real condition', () => {
  const messages = checkHooks('function Screen({ ready }) { if (ready) useState(0); return null }')
  expect(messages).toHaveLength(1)
  expect(messages[0].ruleId).toBe('react-hooks/rules-of-hooks')
  expect(messages[0].message).toMatch(/conditionally/)
})
