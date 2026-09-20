import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const CONTINUO_FLAG_ID = 'continuo';
export const CONTINUO_FLAG_ENV = 'KIMI_CODE_EXPERIMENTAL_CONTINUO';

export const continuoFlag: FlagDefinitionInput = {
  id: CONTINUO_FLAG_ID,
  title: 'Continuo workspace',
  description: 'Continuo: persistent workspace context, proactive first-open understanding and a task board served by kap-server.',
  env: CONTINUO_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(continuoFlag);
