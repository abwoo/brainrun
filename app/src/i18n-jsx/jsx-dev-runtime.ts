import { jsxDEV as reactJsxDEV, Fragment } from 'react/jsx-dev-runtime';
import { localizeProps } from '../lib/localizedText';
export { Fragment };
export type { JSX } from 'react';
export const jsxDEV: typeof reactJsxDEV = (type, props, key, isStatic, source, self) =>
 reactJsxDEV(type, localizeProps(props), key, isStatic, source, self);
