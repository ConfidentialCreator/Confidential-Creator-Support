type Props = {
  revealed: boolean
  // Absent on the public page and in the support flow: no figure exists in the DOM there.
  figure?: string
  delayMs?: number
}

export function Sealed({ revealed, figure, delayMs = 0 }: Props) {
  return (
    <span className={revealed ? 'sealed sealed-on' : 'sealed'}>
      <span className="fig">{figure ?? ' '}</span>
      <span className="bar" style={{ transitionDelay: `${delayMs}ms` }} />
    </span>
  )
}
