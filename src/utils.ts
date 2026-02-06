import { format } from 'node:util';
import { SchemaPublicationResult } from '@truvity/sdk';

export const log = (message: string, ...param: unknown[]): void => {
    console.info(format(message, ...param));
};

export const logSection = (title: string): void => {
    const line = '═'.repeat(60);
    console.info(`\n${line}`);
    console.info(`  ${title}`);
    console.info(`${line}\n`);
};

export const logSchemaPublication = (schemaName: string, result: SchemaPublicationResult): void => {
    log('  Schema "%s": %s', schemaName, result.published ? 'published ✓' : 'already published ✓');
};
