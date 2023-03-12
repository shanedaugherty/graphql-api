import { ApolloConfigFactoryService } from '../graphql-config/apollo-config-factory.service'
import { SchemaGeneratorService } from '../graphql-config/schema-generator.service'
import { GraphQLFormattedError } from 'graphql'
import { GitAdapter } from '@contentlab/git-adapter'
import { ApolloServer, ApolloServerOptions } from '@apollo/server'
import { VariableValues } from '@apollo/server/src/externalTypes/graphql'
import { GraphQLRequest } from '@apollo/server/src/externalTypes'
import { DocumentNode, TypedQueryDocumentNode } from 'graphql/index'

export class ApiService {
  constructor(
    private readonly apolloConfigFactory: ApolloConfigFactoryService,
    private readonly schemaGenerator: SchemaGeneratorService,
  ) {}

  async postGraphQL<
    TData = Record<string, unknown>,
    TVariables extends VariableValues = VariableValues,
  >(
    gitAdapter: GitAdapter,
    ref: string,
    request: Omit<GraphQLRequest<TVariables>, 'query'> & {
      query?: string | DocumentNode | TypedQueryDocumentNode<TData, TVariables>
    },
  ): Promise<GraphQLResponse<TData>> {
    let currentRef = await gitAdapter.getLatestCommitHash(ref)
    const context: ApolloContext = {
      branch: ref,
      gitAdapter: gitAdapter,
      getCurrentRef(): string {
        return currentRef
      },
      setCurrentRef(refArg: string) {
        currentRef = refArg
      },
    }

    const apolloDriverConfig: ApolloServerOptions<ApolloContext> =
      await this.apolloConfigFactory.createGqlOptions(context)

    const apolloServer = new ApolloServer<ApolloContext>({
      ...apolloDriverConfig,
    })

    const result = await apolloServer.executeOperation<TData, TVariables>(
      request,
      {
        contextValue: context,
      },
    )

    return {
      ref: context.getCurrentRef(),
      data:
        result.body.kind === 'single'
          ? result.body.singleResult.data
          : undefined,
      errors:
        result.body.kind === 'single'
          ? result.body.singleResult.errors
          : undefined,
    }
  }

  async getSchema(
    gitAdapter: GitAdapter,
    ref: string,
  ): Promise<SchemaResponse> {
    let currentRef = await gitAdapter.getLatestCommitHash(ref)
    const contextGenerator = () =>
      ({
        branch: ref,
        gitAdapter: gitAdapter,
        getCurrentRef(): string {
          return currentRef
        },
        setCurrentRef(refArg: string) {
          currentRef = refArg
        },
      } as ApolloContext)

    const typeDefinitionStrings = (
      await this.schemaGenerator.generateSchema(contextGenerator())
    ).typeDefs
    if (!Array.isArray(typeDefinitionStrings)) {
      throw new Error('Unknown element')
    }

    return {
      ref: contextGenerator().getCurrentRef(),
      data: typeDefinitionStrings.join('\n'),
    }
  }
}

export interface ApolloContext {
  branch: string
  gitAdapter: GitAdapter
  getCurrentRef(): string
  setCurrentRef(sha: string): void
}

export interface GraphQLResponse<TData> {
  ref: string
  data?: TData
  errors: ReadonlyArray<GraphQLFormattedError>
}

export interface SchemaResponse {
  ref: string
  data: string
}
