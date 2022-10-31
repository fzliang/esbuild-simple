const esbuild2 = require('./esbuild2');


let examplePlugin = {
  name: 'example',
  setup(build) {
    build.onLoad({ filter: /.*/}, (args) => {
      console.log(args)
      return {
        contents: 'testtesttest'
      }
    })
  },
}

const result = esbuild2.build({
  entryPoints: ['test/app.js'],
  bundle: true,
  outfile: 'test/out.js',
  plugins: [examplePlugin],
});


setTimeout(() => {
  console.log(result)
}, 1000)
