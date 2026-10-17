/** Pause the reading delay while the browser is hidden; cancel when the menu closes. */
export function scheduleNotificationRead(onRead: () => void, visibility: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> = document) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    if (visibility.visibilityState === 'visible') timer = setTimeout(onRead, 3000);
  };
  visibility.addEventListener('visibilitychange', schedule);
  schedule();
  return () => {
    clearTimeout(timer);
    visibility.removeEventListener('visibilitychange', schedule);
  };
}
