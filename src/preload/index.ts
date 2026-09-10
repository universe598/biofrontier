import { contextBridge, ipcRenderer } from 'electron'
import type { BioFrontierApi } from '../shared/types'

const api: BioFrontierApi = {
  articles: {
    list: (filter) => ipcRenderer.invoke('articles:list', filter),
    sync: () => ipcRenderer.invoke('articles:sync'),
    bookmark: (id, value) => ipcRenderer.invoke('articles:bookmark', id, value),
    read: (id, value) => ipcRenderer.invoke('articles:read', id, value),
    download: (id) => ipcRenderer.invoke('articles:download', id),
    open: (id) => ipcRenderer.invoke('articles:open', id)
  },
  ai: {
    summarize: (id) => ipcRenderer.invoke('ai:summarize', id),
    match: (query) => ipcRenderer.invoke('ai:match', query),
    models: (provider, apiKey) => ipcRenderer.invoke('ai:models', provider, apiKey),
    disclosureAccepted: (provider) => ipcRenderer.invoke('ai:disclosureAccepted', provider),
    acceptDisclosure: (provider) => ipcRenderer.invoke('ai:acceptDisclosure', provider),
    grantOnce: (provider) => ipcRenderer.invoke('ai:grantOnce', provider),
    revokeDisclosure: (provider) => ipcRenderer.invoke('ai:revokeDisclosure', provider)
  },
  legal: {
    status: () => ipcRenderer.invoke('legal:status'),
    accept: () => ipcRenderer.invoke('legal:accept'),
    quit: () => ipcRenderer.invoke('legal:quit')
  },
  sources: {
    list: () => ipcRenderer.invoke('sources:list'),
    addRss: (input) => ipcRenderer.invoke('sources:addRss', input),
    update: (id, changes) => ipcRenderer.invoke('sources:update', id, changes),
    remove: (id) => ipcRenderer.invoke('sources:remove', id),
    importUrl: (url) => ipcRenderer.invoke('sources:importUrl', url),
    syncDue: () => ipcRenderer.invoke('sources:syncDue')
  },
  classifier: {
    status: () => ipcRenderer.invoke('classifier:status'),
    run: () => ipcRenderer.invoke('classifier:run'),
    stop: () => ipcRenderer.invoke('classifier:stop'),
    chooseModel: () => ipcRenderer.invoke('classifier:chooseModel'),
    chooseRuntime: () => ipcRenderer.invoke('classifier:chooseRuntime'),
    clearConfiguration: () => ipcRenderer.invoke('classifier:clearConfiguration'),
    test: () => ipcRenderer.invoke('classifier:test'),
    openOfficialPage: (target) => ipcRenderer.invoke('classifier:openOfficialPage', target),
    apiStatus: () => ipcRenderer.invoke('classifier:apiStatus'),
    runApi: () => ipcRenderer.invoke('classifier:runApi'),
    stopApi: () => ipcRenderer.invoke('classifier:stopApi')
  },
  research: {
    start: (request) => ipcRenderer.invoke('research:start', request),
    status: () => ipcRenderer.invoke('research:status'),
    cancel: () => ipcRenderer.invoke('research:cancel'),
    reports: () => ipcRenderer.invoke('research:reports'),
    export: (id) => ipcRenderer.invoke('research:export', id)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
    setApiKey: (provider, key) => ipcRenderer.invoke('settings:setApiKey', provider, key),
    chooseLibrary: () => ipcRenderer.invoke('settings:chooseLibrary')
  },
  profile: {
    get: () => ipcRenderer.invoke('profile:get'),
    save: (profile) => ipcRenderer.invoke('profile:save', profile),
    chooseAvatar: () => ipcRenderer.invoke('profile:chooseAvatar'),
    removeAvatar: () => ipcRenderer.invoke('profile:removeAvatar')
  }
}

contextBridge.exposeInMainWorld('biofrontier', api)
