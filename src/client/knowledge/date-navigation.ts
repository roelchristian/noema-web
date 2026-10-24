import {createContext} from 'react';
import type {TemporalDate} from '../../shared/temporal';
export const DateNavigation=createContext<((date:TemporalDate)=>void)|undefined>(undefined);
