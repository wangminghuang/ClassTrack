;(() => {
  const scroll = document.querySelector('[data-schedule-scroll]')
  const grid = document.querySelector('[data-schedule-grid]')
  const cs = (el, p) => (el ? getComputedStyle(el)[p] : null)
  if (!scroll || !grid) return JSON.stringify({ error: 'missing nodes' })
  return JSON.stringify({
    innerH: window.innerHeight,
    innerW: window.innerWidth,
    scroll: {
      clientH: scroll.clientHeight,
      scrollH: scroll.scrollHeight,
      clientW: scroll.clientWidth,
      scrollW: scroll.scrollWidth,
      scrollTop: scroll.scrollTop,
      scrollLeft: scroll.scrollLeft,
      canScrollY: scroll.scrollHeight > scroll.clientHeight,
      overflowY: cs(scroll, 'overflowY'),
      touchAction: cs(scroll, 'touchAction'),
      transform: cs(scroll, 'transform'),
      styleTransform: scroll.style.transform,
      opacity: cs(scroll, 'opacity'),
      parentClass: scroll.parentElement.className,
      parentClientH: scroll.parentElement.clientHeight,
      grandParentClientH: scroll.parentElement.parentElement.clientHeight,
    },
    grid: {
      clientH: grid.clientHeight,
      scrollH: grid.scrollHeight,
      rectH: Math.round(grid.getBoundingClientRect().height * 100) / 100,
      rows: cs(grid, 'gridTemplateRows'),
    },
    courseCells: document.querySelectorAll('[data-course-cell]').length,
  })
})()
