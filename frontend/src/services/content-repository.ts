import { SiteContent } from '../domain/types';
import { save, load } from './storage';
import { defaultContent } from '../data/default-content';
const KEY = 'site_content';
export const getContent = (): SiteContent => load(KEY) || defaultContent;
export const saveContent = (data: SiteContent) => save(KEY, data);