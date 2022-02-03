import * as TypeDoc from 'typedoc';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { format } from 'prettier';
import options from '../.prettierrc.cjs';
import faker from '../src';
import type {
  Method,
  MethodParameter,
} from '../docs/.vitepress/components/api-docs/method.js';

const pathRoot = resolve(__dirname, '..');
const pathDocsDir = resolve(pathRoot, 'docs');
const pathDocsApiPages = resolve(pathDocsDir, '.vitepress', 'api-pages.mjs');
const pathOutputDir = resolve(pathDocsDir, 'api');
const pathOutputJson = resolve(pathOutputDir, 'typedoc.json');

const scriptCommand = 'pnpm run generate:api-docs';

function toBlock(comment?: TypeDoc.Comment): string {
  return (
    (comment?.shortText.trim() || 'Missing') +
    (comment?.text ? '\n\n' + comment.text : '')
  );
}

// https://stackoverflow.com/a/6234804/6897682
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parameterRow(
  name: string,
  type?: string,
  def?: string,
  comment?: TypeDoc.Comment
): string {
  def = def ? `<code>${def}</code>` : '';
  return `<tr>
  <td>${escapeHtml(name)}</td>
  <td>${escapeHtml(type)}</td>
  <td>${def}</td>
  <td>

::: v-pre

${toBlock(comment)}

:::

  </td>
</tr>
`;
}

async function build(): Promise<void> {
  const app = new TypeDoc.Application();

  app.options.addReader(new TypeDoc.TSConfigReader());
  // If you want TypeDoc to load typedoc.json files
  //app.options.addReader(new TypeDoc.TypeDocReader());

  app.bootstrap({
    entryPoints: ['src/index.ts'],
    pretty: true,
    cleanOutputDir: true,
  });

  const project = app.convert();

  if (!project) {
    // Project may not have converted correctly
    return;
  }
  // Useful for analyzing the content
  await app.generateJson(project, pathOutputJson);

  const modules = project
    .getChildrenByKind(TypeDoc.ReflectionKind.Namespace)[0]
    .getChildrenByKind(TypeDoc.ReflectionKind.Class);

  const modulesPages: Array<{ text: string; link: string }> = [];
  modulesPages.push({ text: 'Fake', link: '/api/fake.html' });
  modulesPages.push({ text: 'Localization', link: '/api/localization.html' });

  // Generate module file
  for (const module of modules) {
    const moduleName = module.name.replace('_', '');
    const lowerModuleName =
      moduleName.substring(0, 1).toLowerCase() + moduleName.substring(1);
    console.log(`Processing Module ${moduleName}`);

    modulesPages.push({
      text: moduleName,
      link: `/api/${lowerModuleName}.html`,
    });

    const methods: Method[] = [];

    // Generate method section
    for (const method of module.getChildrenByKind(
      TypeDoc.ReflectionKind.Method
    )) {
      const methodName = method.name;
      const prettyMethodName =
        methodName.substring(0, 1).toUpperCase() +
        methodName.substring(1).replace(/([A-Z]+)/g, ' $1');
      console.debug(`- method ${prettyMethodName}`);
      const signature = method.signatures[0];

      const parameters: MethodParameter[] = [];

      // typeParameters
      const typeParameters = signature.typeParameters || [];
      const signatureTypeParameters: string[] = [];
      for (const parameter of typeParameters) {
        signatureTypeParameters.push(parameter.name);
        parameters.push({
          name: parameter.name,
          description: toBlock(parameter.comment),
        });
      }

      // parameters
      const signatureParameters: string[] = [];
      let requiresArgs = false;
      for (
        let index = 0;
        signature.parameters && index < signature.parameters.length;
        index++
      ) {
        const parameter = signature.parameters[index];

        const parameterDefault = parameter.defaultValue;
        const parameterRequired = typeof parameterDefault === 'undefined';
        if (index == 0) {
          requiresArgs = parameterRequired;
        }
        const parameterName = parameter.name + (parameterRequired ? '?' : '');
        const parameterType = parameter.type.toString();

        let parameterDefaultSignatureText = '';
        if (!parameterRequired) {
          parameterDefaultSignatureText = ' = ' + parameterDefault;
        }

        signatureParameters.push(
          parameterName + ': ' + parameterType + parameterDefaultSignatureText
        );
        parameters.push({
          name: parameter.name,
          type: parameterType,
          default: parameterDefault,
          description: toBlock(parameter.comment),
        });
      }

      // Generate usage section

      let signatureTypeParametersString = '';
      if (signatureTypeParameters.length !== 0) {
        signatureTypeParametersString = `<${signatureTypeParameters.join(
          ', '
        )}>`;
      }
      const signatureParametersString = signatureParameters.join(', ');

      let examples = `faker.${lowerModuleName}.${methodName}${signatureTypeParametersString}(${signatureParametersString}): ${signature.type.toString()}\n`;
      faker.seed(0);
      if (!requiresArgs) {
        try {
          let example = JSON.stringify(faker[lowerModuleName][methodName]());
          if (example.length > 50) {
            example = example.substring(0, 47) + '...';
          }

          examples += `faker.${lowerModuleName}.${methodName}()`;
          examples += (example ? ` // => ${example}` : '') + '\n';
        } catch (error) {
          // Ignore the error => hide the example call + result.
        }
      }
      const exampleTags =
        signature?.comment?.tags
          .filter((tag) => tag.tagName === 'example')
          .map((tag) => tag.text.trimEnd()) || [];

      if (exampleTags.length !== 0) {
        examples += exampleTags.join('\n').trim() + '\n';
      }

      methods.push({
        name: prettyMethodName,
        description: toBlock(signature.comment),
        parameters: parameters,
        returns: signature.type.toString(),
        examples: examples,
      });
    }

    // Format md
    let content = `
      <script setup>
      import ApiDocsMethod from '../.vitepress/components/api-docs/method.vue'
      import { ref } from 'vue';

      const methods = ref(${JSON.stringify(methods)});
      </script>

      # ${moduleName}

      <!-- This file is automatically generated. -->
      <!-- Run '${scriptCommand}' to update -->

      ::: v-pre

      ${toBlock(module.comment)}

      :::

      <ApiDocsMethod v-for="method of methods" v-bind:key="method.name" :method="method" />
      `.replace(/\n +/g, '\n');

    content = format(content, {
      ...options,
      parser: 'markdown',
    });

    // Write to disk

    writeFileSync(resolve(pathOutputDir, lowerModuleName + '.md'), content);
  }

  // Write api-pages.mjs
  console.log('Updating api-pages.mjs');
  modulesPages.sort((a, b) => a.text.localeCompare(b.text));
  let apiPagesContent = `
    // This file is automatically generated.
    // Run '${scriptCommand}' to update
    export const apiPages = ${JSON.stringify(modulesPages)};
    `.replace(/\n +/, '\n');

  apiPagesContent = format(apiPagesContent, {
    ...options,
    parser: 'babel',
  });

  writeFileSync(pathDocsApiPages, apiPagesContent);
}

build().catch(console.error);
