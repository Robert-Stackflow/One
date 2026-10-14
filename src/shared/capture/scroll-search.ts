/** Coarse row averages locate promising overlaps; original pixels decide the result. */
export function scrollSearchCandidates(a:Uint8Array,b:Uint8Array,axis:number,cross:number,left:number,right:number){
  const maxShift=axis-Math.max(32,Math.ceil(axis*.22));let factor=1;
  while(axis/factor>512&&factor<32)factor*=2;
  const exhaustive=()=>Array.from({length:maxShift*2+1},(_,index)=>index-maxShift).filter(shift=>shift!==0);
  if(factor===1)return exhaustive();
  const rows=Math.ceil(axis/factor),columns=Math.min(24,right-left);
  const signature=(pixels:Uint8Array)=>{
    const values=new Float32Array(rows*columns*3);
    for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
      const x=left+Math.floor((column+.5)*(right-left)/columns),start=row*factor,end=Math.min(axis,start+factor);
      for(let y=start;y<end;y++)for(let channel=0;channel<3;channel++)values[(row*columns+column)*3+channel]+=pixels[(y*cross+x)*4+channel]/(end-start);
    }
    return values;
  };
  const first=signature(a),second=signature(b),limit=Math.ceil(maxShift/factor),guesses:{shift:number;score:number}[]=[];
  for(let shift=-limit;shift<=limit;shift++){
    const start=Math.max(0,-shift),end=Math.min(rows,rows-shift),samples=Math.min(24,end-start),scores:number[]=[];
    for(let column=0;column<columns;column++){
      let sum=0,count=0;
      for(let sample=0;sample<samples;sample++){
        const phase=(sample*.61803398875+.38196601125)%1,row=start+Math.floor((sample+phase)*(end-start)/samples);
        for(let channel=0;channel<3;channel++){sum+=Math.abs(first[((row+shift)*columns+column)*3+channel]-second[(row*columns+column)*3+channel]);count++;}
      }
      scores.push(sum/count);
    }
    scores.sort((a,b)=>a-b);const keep=Math.ceil(scores.length*.9);guesses.push({shift,score:scores.slice(0,keep).reduce((a,b)=>a+b,0)/keep});
  }
  guesses.sort((a,b)=>a.score-b.score);
  if(guesses[24]&&guesses[24].score-guesses[0].score<.5)return exhaustive();
  const selected:number[]=[],candidates=new Set<number>();
  for(const guess of guesses){
    if(selected.some(shift=>Math.abs(shift-guess.shift)<=1))continue;
    selected.push(guess.shift);
    for(let shift=Math.max(-maxShift,guess.shift*factor-factor*2);shift<=Math.min(maxShift,guess.shift*factor+factor*2);shift++)if(shift)candidates.add(shift);
    if(selected.length===24)break;
  }
  return [...candidates];
}

/** Use a different sampling phase in spatial cells to reject coincidental grid matches. */
export function scrollLocallyConsistent(a:Uint8Array,b:Uint8Array,axis:number,cross:number,left:number,right:number,shift:number,omit?:(oldRow:number,newRow:number,x:number)=>boolean){
  const start=Math.max(0,-shift),end=Math.min(axis,axis-shift),rows=6,columns=6,goodRows=new Uint8Array(rows),goodColumns=new Uint8Array(columns);let good=0;
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    let error=0,count=0;
    for(let y=0;y<4;y++)for(let x=0;x<4;x++){
      const py=start+Math.floor((row+(y+.61803398875)/4)*(end-start)/rows),px=left+Math.floor((column+(x+.38196601125)/4)*(right-left)/columns);
      if(omit?.(py+shift,py,px))continue;
      const first=((py+shift)*cross+px)*4,second=(py*cross+px)*4;
      for(let channel=0;channel<3;channel++){error+=Math.abs(a[first+channel]-b[second+channel]);count++;}
    }
    if(count>=24&&error/count<=6){good++;goodRows[row]++;goodColumns[column]++;}
  }
  return good>=28&&goodRows.every(count=>count>=4)&&[...goodColumns].filter(count=>count>=4).length>=5;
}
