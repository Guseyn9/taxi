import { useCallback, useEffect, useRef, useState } from 'react'
import type { ISuggestion } from '../types/types'

export type AddressSearchStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
interface Options {
  query: string
  /** Change this key whenever search context (e.g. city or pickup coordinates) changes. */
  contextKey: string
  search: (query: string) => Promise<ISuggestion[]>
}
interface SearchState {
  identity: string
  status: AddressSearchStatus
  suggestions: ISuggestion[]
}

/** Display-only async search lifecycle. The supplied transport remains unchanged. */
export function useAddressSearch({ query, contextKey, search }: Options) {
  const normalizedQuery = query.trim()
  const [attempt, setAttempt] = useState(0)
  const identity = JSON.stringify([normalizedQuery, contextKey, attempt])
  const latestIdentity = useRef(identity)
  const latestSearch = useRef(search)
  latestIdentity.current = identity
  latestSearch.current = search
  const [state, setState] = useState<SearchState>({ identity, status: 'idle', suggestions: [] })

  useEffect(() => {
    let active = true
    let settled = false
    let timeout: number | undefined
    setState({ identity, status: 'idle', suggestions: [] })
    if (Array.from(normalizedQuery).length < 3) return () => { active = false }

    const complete = (status: AddressSearchStatus, suggestions: ISuggestion[] = []) => {
      if (!active || settled || latestIdentity.current !== identity) return
      settled = true
      window.clearTimeout(timeout)
      setState({ identity, status, suggestions })
    }
    const debounce = window.setTimeout(() => {
      if (!active || latestIdentity.current !== identity) return
      setState({ identity, status: 'loading', suggestions: [] })
      timeout = window.setTimeout(() => complete('error'), 10000)
      try {
        Promise.resolve(latestSearch.current(normalizedQuery)).then(
          suggestions => {
            if (!Array.isArray(suggestions)) complete('error')
            else complete(suggestions.length ? 'ready' : 'empty', suggestions)
          },
          () => complete('error'),
        )
      } catch {
        complete('error')
      }
    }, 350)
    return () => {
      active = false
      window.clearTimeout(debounce)
      window.clearTimeout(timeout)
    }
  }, [identity, normalizedQuery])

  const retry = useCallback(() => {
    if (Array.from(normalizedQuery).length >= 3) setAttempt(value => value + 1)
  }, [normalizedQuery])
  // A new query must never briefly render suggestions belonging to the previous one.
  const current = state.identity === identity ? state : { status: 'idle' as AddressSearchStatus, suggestions: [] }
  return { suggestions: current.suggestions, status: current.status, retry }
}

export default useAddressSearch
