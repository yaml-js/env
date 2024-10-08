import * as fs from 'fs'
import * as path from 'path'
import { parse as parseYaml } from 'yaml'

import { Logger, createConsoleLogger } from './logger'
import { YamlContent } from './types'

const knownEnvironments: Record<string, string> = {
  DEV: 'development',
  DEVELOPMENT: 'development',
  TST: 'test',
  TEST: 'test',
  PROD: 'production',
  PRODUCTION: 'production'
}

const isObject = (item: unknown): boolean => {
  return item !== null && typeof item === 'object' && !Array.isArray(item)
}

const merge = (target: YamlContent, source: YamlContent): YamlContent => {
  const result = { ...target }
  for (const key in source) {
    const sourceValue = source[key]
    if (isObject(sourceValue) && isObject(target[key])) {
      result[key] = merge(target[key], sourceValue)
    } else {
      result[key] = sourceValue
    }
  }
  return result
}

const mergeFromContet = (target: YamlContent, content: string): YamlContent => {
  const yamlContent = parseYaml(content) as YamlContent
  return merge(target, yamlContent)
}

const discoverEnvironmentFromValue = (value: string): string => {
  const env = value.toUpperCase()
  if (knownEnvironments[env]) {
    return knownEnvironments[env]
  } else {
    return value
  }
}

const discoverEnvironment = (logger: Logger): string => {
  if (process.env.APP_ENV) {
    return discoverEnvironmentFromValue(process.env.APP_ENV)
  } else if (process.env.NODE_ENV) {
    return discoverEnvironmentFromValue(process.env.NODE_ENV)
  } else {
    logger.warn(() => `No environment value found, defaulting to production`)
    return 'production'
  }
}

const removeFileExtension = (filePath: string): { name: string; extension: string | null } => {
  const separator = path.sep
  const lastSeparatorIndex = filePath.lastIndexOf(separator)
  const fileName = lastSeparatorIndex !== -1 ? filePath.slice(lastSeparatorIndex + 1) : filePath
  const lastDotIndex = fileName.lastIndexOf('.')

  if (lastDotIndex !== -1) {
    const name = filePath.slice(0, filePath.length - (fileName.length - lastDotIndex))
    const extension = fileName.slice(lastDotIndex + 1)
    return { name, extension }
  } else {
    return { name: filePath, extension: null }
  }
}

const getFiles = (logger: Logger, includeLocal: boolean, filePath: string | undefined, environment: string | undefined): string[] => {
  const env = environment ?? discoverEnvironment(logger)
  filePath = filePath ?? './config'
  const { name, extension } = removeFileExtension(filePath)
  if (extension) {
    if (includeLocal) {
      return [`${filePath}`, `${name}.${env}.${extension}`, `${name}.${env}.local.${extension}`]
    } else {
      return [`${filePath}`, `${name}.${env}.${extension}`]
    }
  } else if (includeLocal) {
    return [
      `${filePath}`,
      `${filePath}.${env}`,
      `${filePath}.${env}.local`,
      `${filePath}.yml`,
      `${filePath}.${env}.yml`,
      `${filePath}.${env}.local.yml`,
      `${filePath}.yaml`,
      `${filePath}.${env}.yaml`,
      `${filePath}.${env}.local.yaml`
    ]
  } else {
    return [`${filePath}`, `${filePath}.${env}`, `${filePath}.yml`, `${filePath}.${env}.yml`, `${filePath}.yaml`, `${filePath}.${env}.yaml`]
  }
}

// Pattern to match ${VAR_NAME} or ${VAR_NAME:DEFAULT_VALUE}
const pattern = /\$\{(?<VAR>[A-Za-z0-9_]+)(?::(?<DEFAULT>[^}]*))?\}/g

const replaceEnvVariables = (content: string): string => {
  const result = content.replaceAll(pattern, (_, varName, defaultValue) => {
    return process.env[varName] ?? defaultValue ?? `\${${varName}}`
  })
  return result
}

export class Reader {
  private logger: Logger

  constructor(logger?: Logger) {
    this.logger = logger ?? createConsoleLogger('EnvYaml.Reader', undefined, 'INFO')
  }

  public async read(includeLocal: boolean = true, filePath?: string, environment?: string): Promise<YamlContent> {
    const files = getFiles(this.logger, includeLocal, filePath, environment)
    let result: YamlContent = {}

    for (const file of files) {
      const exists = await fs.promises
        .access(file, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false)
      if (exists) {
        this.logger.debug(() => `Reading file ${file}`)
        const content = await fs.promises.readFile(file, 'utf8')
        result = mergeFromContet(result, replaceEnvVariables(content))
      }
    }
    return result
  }

  public readSync(includeLocal: boolean = true, filePath?: string, environment?: string): YamlContent {
    const files = getFiles(this.logger, includeLocal, filePath, environment)
    let result: YamlContent = {}

    for (const file of files) {
      const exists = fs.existsSync(file)
      if (exists) {
        this.logger.debug(() => `Reading file ${file}`)
        const content = fs.readFileSync(file, 'utf8')
        result = mergeFromContet(result, replaceEnvVariables(content))
      }
    }
    return result
  }
}

export interface ReaderOptions {
  includeLocal?: boolean
  filePath?: string
  environment?: string
}

const defaultReader = new Reader()
export const readAsync = (options: ReaderOptions): Promise<YamlContent> => {
  return defaultReader.read(options.includeLocal ?? true, options.filePath, options.environment)
}

export const read = (options: ReaderOptions): YamlContent => {
  return defaultReader.readSync(options.includeLocal ?? true, options.filePath, options.environment)
}

export default read
