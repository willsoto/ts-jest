import * as path from 'path';
import * as fs from 'fs';
import includes = require('lodash.includes');
import partition = require('lodash.partition');
const loadCoverage = require('remap-istanbul/lib/loadCoverage');
const remap = require('remap-istanbul/lib/remap');
const writeReport = require('remap-istanbul/lib/writeReport');
const istanbulInstrument = require('istanbul-lib-instrument');
import pickBy = require('lodash.pickby')
import {getJestConfig} from './utils';
const glob = require('glob-all');

interface CoverageMap {
  merge: (data: Object) => void;
  getCoverageSummary: () => Object;
  data: Object;
  addFileCoverage: (fileCoverage: Object) => void;
}

declare const global: {
    __ts_coverage__cache__: {
        coverageConfig: any;
        sourceCache: any[];
        coverageCollectFiles: any[];
    }
};

// full type https://github.com/facebook/jest/blob/master/types/TestResult.js
interface Result {
  coverageMap: CoverageMap;
}

function processResult(result: Result): Result {
  const root = require('jest-util').getPackageRoot();
  const jestConfig = getJestConfig(root).config;
  let sourceCache = {};
  let coveredFiles = [];
  walkDir(path.join(jestConfig.cacheDirectory, '/ts-jest/')).map((p) => {
    let filename = p.replace(path.join(jestConfig.cacheDirectory, '/ts-jest/'), '');
    coveredFiles.push(filename);
    sourceCache[filename] = fs.readFileSync(p, 'utf8');
  });

  if (!jestConfig.testResultsProcessor) return result;
  const coverageConfig = {
    collectCoverage: jestConfig.collectCoverage,
    coverageDirectory: jestConfig.coverageDirectory ? jestConfig.coverageDirectory : './coverage/',
    coverageReporters: jestConfig.coverageReporters
  };
  const coverageCollectFiles =
      jestConfig.collectCoverage &&
      jestConfig.testResultsProcessor &&
      jestConfig.collectCoverageFrom &&
      jestConfig.collectCoverageFrom.length ?
            glob.sync(jestConfig.collectCoverageFrom).map(x => path.resolve(root, x)) : [];
  if (!coverageConfig.collectCoverage) return result;
  console.log(coverageConfig);

  const coverage = [pickBy(result.coverageMap.data, (_, fileName) => includes(coveredFiles, fileName))];

  const uncoveredFiles = partition(coverageCollectFiles, x => includes(coveredFiles, x))[1];
  const coverageOutputPath = path.join(coverageConfig.coverageDirectory || 'coverage', 'remapped');

  // //generate 'empty' coverage against uncovered files.
  // //If source is non-ts passed by allowJS, return empty since not able to lookup from cache
  const emptyCoverage = uncoveredFiles.map((x:string) => {
    let ret = {};
    if (sourceCache[x]) {
      let instrumenter = istanbulInstrument.createInstrumenter();
      instrumenter.instrumentSync(sourceCache[x], x);
      ret[x] = instrumenter.fileCoverage;
    }
    return ret;
  });

  const mergedCoverage = loadCoverage(coverage.concat(emptyCoverage), { readJSON: (t) => t ? t : {} });
  const coverageCollector = remap(mergedCoverage, {
    readFile: (x) => {
      const key = path.normalize(x);
      const source = sourceCache[key];
      delete sourceCache[key];
      return source;
    }
  });

  writeReport(coverageCollector, 'html', {}, path.join(coverageOutputPath, 'html'));
  writeReport(coverageCollector, 'lcovonly', {}, path.join(coverageOutputPath, 'lcov.info'));
  writeReport(coverageCollector, 'json', {}, path.join(coverageOutputPath, 'coverage.json'));
  writeReport(coverageCollector, 'text', {}, path.join(coverageOutputPath, 'coverage.txt'));
  return result;
}

function walkDir(root) {
  const stat = fs.statSync(root);

  if (stat.isDirectory()) {
    const dirs = fs.readdirSync(root).filter(item => !item.startsWith('.'));
    let results = dirs.map(sub => walkDir(`${root}/${sub}`));
    return [].concat(...results);
  } else {
    return root;
  }
}

module.exports = processResult;