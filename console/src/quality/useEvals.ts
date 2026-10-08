import { useCallback, useState } from 'react'
import { runEvals, type EvalCase, type Kpi } from '@/api/admin'

export interface EvalState {
  phase: 'idle' | 'running' | 'done' | 'error'
  total: number
  validated: boolean
  cases: EvalCase[]
  kpis: Kpi[]
  passed: boolean | null
  error: string | null
  startedAt: number | null
  finishedAt: number | null
}

const empty: EvalState = {
  phase: 'idle',
  total: 0,
  validated: false,
  cases: [],
  kpis: [],
  passed: null,
  error: null,
  startedAt: null,
  finishedAt: null,
}

/** L'évaluation vit au niveau de l'application : on peut changer de vue pendant qu'elle tourne. */
export function useEvals() {
  const [state, setState] = useState<EvalState>(empty)
  const start = useCallback(() => {
    setState({ ...empty, phase: 'running', startedAt: Date.now() })
    runEvals((e) => {
      setState((s) => {
        switch (e.type) {
          case 'eval_started':
            return { ...s, total: e.total, validated: e.validated }
          case 'eval_case':
            return { ...s, cases: [...s.cases, e] }
          case 'eval_finished':
            return { ...s, phase: 'done', kpis: e.report.kpis, passed: e.report.passed, finishedAt: Date.now() }
          case 'eval_error':
            return { ...s, phase: 'error', error: e.message }
        }
      })
    }).catch((err: Error) => setState((s) => ({ ...s, phase: 'error', error: err.message })))
  }, [])
  return { state, start }
}
