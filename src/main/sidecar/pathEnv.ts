import { delimiter } from 'node:path'

export function prependPathDir(env: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv {
  const path = env.PATH
  return { ...env, PATH: path ? `${dir}${delimiter}${path}` : dir }
}
