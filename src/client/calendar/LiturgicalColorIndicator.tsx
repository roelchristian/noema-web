const colorNames:Record<string,string>={
 white:'white',albus:'white',red:'red',ruber:'red',green:'green',viridis:'green',
 purple:'purple',violet:'purple',purpura:'purple',violaceus:'purple',
 rose:'rose',rosea:'rose',roseus:'rose',black:'black',niger:'black',
 blue:'blue',caeruleus:'blue',gold:'gold',aureus:'gold',
};

export function principalLiturgicalColor(colors:string[]) {
 return colors.map(color=>colorNames[color.toLowerCase()]).find(Boolean);
}

export function LiturgicalColorIndicator({colors}:{colors:string[]}) {
 const markers=[...new Set(colors.map(color=>colorNames[color.toLowerCase()]).filter(Boolean))];
 if(!markers.length)return null;
 return <span className="calendar-liturgical-colors" aria-hidden="true" title={`Liturgical color: ${colors.join(' / ')}`}>{markers.map(color=><span className="calendar-liturgical-color" data-color={color} key={color}/>)}</span>;
}
