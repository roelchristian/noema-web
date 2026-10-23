/** Serializable browser callback: offsets are UTF-16 positions in the whole surface,
 * including formatted/date spans, rather than positions in one DOM text node. */
export function selectionOffsets(element) {
  const selection=element.ownerDocument.getSelection();
  if(!selection?.rangeCount||!element.contains(selection.anchorNode)||!element.contains(selection.focusNode))return null;
  const offset=(node,position)=>{
    const range=element.ownerDocument.createRange();
    range.selectNodeContents(element);range.setEnd(node,position);
    return range.toString().length;
  };
  return {anchor:offset(selection.anchorNode,selection.anchorOffset),focus:offset(selection.focusNode,selection.focusOffset)};
}
