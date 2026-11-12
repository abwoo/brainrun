import { jsx as reactJsx, jsxs as reactJsxs, Fragment } from 'react/jsx-runtime';
import { localizeProps } from '../lib/localizedText';
export { Fragment };
export type { JSX } from 'react';
export const jsx: typeof reactJsx = (type, props, key) => reactJsx(type, localizeProps(props), key);
export const jsxs: typeof reactJsxs = (type, props, key) => reactJsxs(type, localizeProps(props), key);
