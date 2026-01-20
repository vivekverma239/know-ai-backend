import { logger } from "./logger";

/**
 * Environment variable configuration with validation
 */
export class EnvConfig {
    private static instance: EnvConfig;
    private envVars: Map<string, string> = new Map();

    private constructor() {
        this.loadAndValidate();
    }

    public static getInstance(): EnvConfig {
        if (!EnvConfig.instance) {
            EnvConfig.instance = new EnvConfig();
        }
        return EnvConfig.instance;
    }

    /**
     * Load and validate all required environment variables
     */
    private loadAndValidate(): void {
        const requiredVars = [
            "SCRAPER_SERVICE_URL",
            "SCRAPER_SERVICE_API_KEY",
            "EXA_API_KEY",
            "FIRECRAWL_API_KEY",
        ];

        const missing: string[] = [];

        // Check required variables
        for (const varName of requiredVars) {
            const value = process.env[varName];
            if (!value) {
                missing.push(varName);
            } else {
                this.envVars.set(varName, value);
            }
        }

        if (missing.length > 0) {
            const errorMessage = `Missing required environment variables: ${missing.join(", ")}`;
            logger.error(errorMessage);
            throw new Error(errorMessage);
        }

        logger.info("Environment variables loaded successfully", {
            totalLoaded: requiredVars.length,
        });
    }

    /**
     * Get an environment variable (throws if not set)
     */
    public get(key: string): string {
        const value = this.envVars.get(key);
        if (!value) {
            throw new Error(`Environment variable ${key} is not set`);
        }
        return value;
    }

    /**
     * Check if an environment variable is set
     */
    public has(key: string): boolean {
        return this.envVars.has(key);
    }

    /**
     * Get all loaded environment variable keys
     */
    public getLoadedKeys(): string[] {
        return Array.from(this.envVars.keys());
    }
}

// Export singleton instance
export const env = EnvConfig.getInstance();
