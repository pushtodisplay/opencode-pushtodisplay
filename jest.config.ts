import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
  moduleFileExtensions: ["ts", "js", "json"],
  // The package targets NodeNext ESM (OpenCode loads the TypeScript entry
  // directly), but jest runs CommonJS by default — force CJS output for tests
  // only. `src/index.ts` is the only file that uses `import.meta`, so tests
  // import the setup factory from `src/extension.ts` instead.
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          verbatimModuleSyntax: false,
          allowImportingTsExtensions: true,
        },
        diagnostics: { ignoreCodes: [1343] },
      },
    ],
  },
  collectCoverageFrom: ["src/**/*.ts", "!src/**/__tests__/**"],
  coverageThreshold: {
    global: {
      statements: 60,
      branches: 50,
      functions: 60,
      lines: 60,
    },
  },
};

export default config;
