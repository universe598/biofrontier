/// <reference types="vite/client" />

import type { BioFrontierApi } from '../../shared/types'

declare global {
  interface Window {
    biofrontier: BioFrontierApi
  }
}

export {}
