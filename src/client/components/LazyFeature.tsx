import {Component, Suspense, lazy, useState, type ComponentType, type ReactNode} from 'react';

class FeatureFailure extends Component<{children:ReactNode;retry:()=>void},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<div className="loading-state" role="alert"><p>This workspace could not be loaded.</p><button className="button" onClick={this.props.retry}>Retry loading</button></div>:this.props.children;}
}
/** Retry creates a new lazy resource because React caches rejected imports. */
export function lazyFeature<P extends object>(load:()=>Promise<{default:ComponentType<P>}>,label:string):ComponentType<P> {
  return function LazyFeature(props:P) {
    const [resource,setResource]=useState(()=>({View:lazy(load),attempt:0}));
    const View=resource.View;
    return <FeatureFailure key={resource.attempt} retry={()=>setResource(current=>({View:lazy(load),attempt:current.attempt+1}))}><Suspense fallback={<p className="loading-state" role="status">Loading {label}…</p>}><View {...props}/></Suspense></FeatureFailure>;
  };
}
