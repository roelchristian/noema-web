import {createContext} from 'react';
import type {ReviewItem} from '../../shared/review-centre';
/** Session navigation intent; never a second persisted review model. */
export const ReviewDestination=createContext<ReviewItem|null>(null);
