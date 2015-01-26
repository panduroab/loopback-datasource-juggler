var DataSource = require('../').DataSource;
var ValidationError = require('../').ValidationError;
var traverse = require('traverse');

module.exports = function(connectorFactory, should) {
  describe('Persistence hooks', function() {
    var observedContexts, expectedError, observersCalled;
    var ds, TestModel, existingInstance;

    beforeEach(function setupEnv(done) {
      observedContexts = "hook not called";
      expectedError = new Error('test error');
      observersCalled = [];

      ds = new DataSource({ connector: connectorFactory });
      TestModel = ds.createModel('TestModel', {
        name: { type: String, required: true },
        id: { type: String, id: true }
      });

      TestModel.create({ name: 'first' }, function(err, instance) {
        if (err) return done(err);
        existingInstance = instance;

        TestModel.create({ name: 'second' }, function(err) {
          if (err) return done(err);
          done();
        });
      });
    });

    describe('PersistedModel.find', function() {
      it('triggers `query` hook', function(done) {
        TestModel.observe('query', pushContextAndNext());

        TestModel.find({ where: { id: '1' } }, function(err, list) {
          if (err) return done(err);
          observedContexts.should.eql(aTestModelCtx({
            query: { where: { id: '1' } }
          }));
          done();
        });
      });

      it('aborts when `query` hook fails', function(done) {
        TestModel.observe('query', nextWithError(expectedError));

        TestModel.find(function(err, list) {
          [err].should.eql([expectedError]);
          done();
        });
      });

      it('applies updates from `query` hook', function(done) {
        TestModel.observe('query', function(ctx, next) {
          ctx.query = { where: { id: existingInstance.id } };
          next();
        });

        TestModel.find(function(err, list) {
          list.map(get('name')).should.eql([existingInstance.name]);
          done();
        });
      });

      // TODO(bajtos) geo query
    });

    describe('PersistedModel.create', function() {
      it('triggers `before save` hook', function(done) {
        TestModel.observe('before save', pushContextAndNext());

        TestModel.create({ name: 'created' }, function(err, instance) {
          if (err) return done(err);
          observedContexts.should.eql(aTestModelCtx({ instance: {
            id: undefined,
            name: 'created'
          }}));
          done();
        });
      });

      it('aborts when `before save` hook fails', function(done) {
        TestModel.observe('before save', nextWithError(expectedError));

        TestModel.create({ name: 'created' }, function(err, instance) {
          [err].should.eql([expectedError]);
          done();
        });
      });

      it('applies updates from `before save` hook', function(done) {
        TestModel.observe('before save', function(ctx, next) {
          ctx.instance.should.be.instanceOf(TestModel);
          ctx.instance.custom = 'hook data';
          next();
        });

        TestModel.create({ name: 'a-name' }, function(err, instance) {
          instance.should.have.property('custom', 'hook data');
          done();
        });
      });

      it('sends `before save` for each model in an array', function(done) {
        TestModel.observe('before save', pushContextAndNext());

        TestModel.create(
          [{ name: 'one' }, { name: 'two' }],
          function(err, list) {
            if (err) return done(err);
            observedContexts.should.eql([
              aTestModelCtx({ instance: { id: undefined, name: 'one' } }),
              aTestModelCtx({ instance: { id: undefined, name: 'two' } }),
            ]);
            done();
          });
      });

      it('validates model after `before save` hook', function(done) {
        TestModel.observe('before save', invalidateTestModel());

        TestModel.create({ name: 'created' }, function(err) {
          (err || {}).should.be.instanceOf(ValidationError);
          (err.details.codes || {}).should.eql({ name: ['presence'] });
          done();
        });
      });

      it('triggers `after save` hook', function(done) {
        TestModel.observe('after save', pushContextAndNext());

        TestModel.create({ name: 'created' }, function(err, instance) {
          if (err) return done(err);
          observedContexts.should.eql(aTestModelCtx({ instance: {
            id: instance.id,
            name: 'created'
          }}));
          done();
        });
      });

      it('aborts when `after save` hook fails', function(done) {
        TestModel.observe('after save', nextWithError(expectedError));

        TestModel.create({ name: 'created' }, function(err, instance) {
          [err].should.eql([expectedError]);
          done();
        });
      });

      it('applies updates from `after save` hook', function(done) {
        TestModel.observe('after save', function(ctx, next) {
          ctx.instance.should.be.instanceOf(TestModel);
          ctx.instance.custom = 'hook data';
          next();
        });

        TestModel.create({ name: 'a-name' }, function(err, instance) {
          instance.should.have.property('custom', 'hook data');
          done();
        });
      });

      it('sends `after save` for each model in an array', function(done) {
        TestModel.observe('after save', pushContextAndNext());

        TestModel.create(
          [{ name: 'one' }, { name: 'two' }],
          function(err, list) {
            if (err) return done(err);
            observedContexts.should.eql([
              aTestModelCtx({ instance: { id: list[0].id, name: 'one' } }),
              aTestModelCtx({ instance: { id: list[1].id, name: 'two' } }),
            ]);
            done();
          });
      });

      it('emits `after save` when some models were not saved', function(done) {
        TestModel.observe('before save', function(ctx, next) {
          if (ctx.instance.name === 'fail')
            next(expectedError);
          else
            next();
        });

        TestModel.observe('after save', pushContextAndNext());

        TestModel.create(
          [{ name: 'ok' }, { name: 'fail' }],
          function(err, list) {
            (err || []).should.have.length(2);
            err[1].should.eql(expectedError);

            // NOTE(bajtos) The current implementation of `Model.create(array)`
            // passes all models in the second callback argument, including
            // the models that were not created due to an error.
            list.map(get('name')).should.eql(['ok', 'fail']);

            observedContexts.should.eql(aTestModelCtx({
              instance: { id: list[0].id, name: 'ok' }
            }));
            done();
          });
      });
    });

    describe('PersistedModel.findOrCreate', function() {
      it('triggers `query` hook', function(done) {
        TestModel.observe('query', pushContextAndNext());

        TestModel.findOrCreate(
          { where: { name: 'new-record' } },
          { name: 'new-record' },
          function(err, record, created) {
            if (err) return done(err);
            observedContexts.should.eql(aTestModelCtx({ query: {
              where: { name: 'new-record' },
              limit: 1,
              offset: 0,
              skip: 0
            }}));
            done();
          });
      });

      // TODO(bajtos) Enable this test for all connectors that
      // provide optimized implementation of findOrCreate.
      // The unoptimized implementation does not trigger the hook
      // when an existing model was found.
      it.skip('triggers `before save` hook when found', function(done) {
        TestModel.observe('before save', pushContextAndNext());

        TestModel.findOrCreate(
          { where: { name: existingInstance.name } },
          { name: existingInstance.name },
          function(err, record, created) {
            if (err) return done(err);
            observedContexts.should.eql(aTestModelCtx({ instance: {
              id: undefined,
              name: existingInstance.name
            }}));
            done();
          });
      });

      it('triggers `before save` hook when not found', function(done) {
        TestModel.observe('before save', pushContextAndNext());

        TestModel.findOrCreate(
          { where: { name: 'new-record' } },
          { name: 'new-record' },
          function(err, record, created) {
            if (err) return done(err);
            observedContexts.should.eql(aTestModelCtx({ instance: {
              id: undefined,
              name: 'new-record'
            }}));
            done();
          });
      });

      it('validates model after `before save` hook', function(done) {
        TestModel.observe('before save', invalidateTestModel());

        TestModel.findOrCreate(
          { where: { name: 'new-record' } },
          { name: 'new-record' },
          function(err) {
            (err || {}).should.be.instanceOf(ValidationError);
            (err.details.codes || {}).should.eql({ name: ['presence'] });
            done();
          });
      });

      it('triggers hooks in the correct order when not found', function(done) {
        var triggered = [];
        TestModel._notify = TestModel.notify;
        TestModel.notify = function(operation, context, callback) {
          triggered.push(operation);
          this._notify.apply(this, arguments);
        };

        TestModel.findOrCreate(
          { where: { name: 'new-record' } },
          { name: 'new-record' },
          function(err, record, created) {
            triggered.should.eql([
              'query',
              'before save',
              'after save'
            ]);
            done();
          });
      });

      it('aborts when `query` hook fails', function(done) {
        TestModel.observe('query', nextWithError(expectedError));

        TestModel.findOrCreate(
          { where: { id: 'does-not-exist' } },
          { name: 'does-not-exist' },
          function(err, instance) {
            [err].should.eql([expectedError]);
            done();
          });
      });

      it('aborts when `before save` hook fails', function(done) {
        TestModel.observe('before save', nextWithError(expectedError));

        TestModel.findOrCreate(
          { where: { id: 'does-not-exist' } },
          { name: 'does-not-exist' },
          function(err, instance) {
            [err].should.eql([expectedError]);
            done();
          });
      });

      it('triggers `after save` hook when not found', function(done) {
        TestModel.observe('after save', pushContextAndNext());

        TestModel.findOrCreate(
          { where: { name: 'new name' } },
          { name: 'new name' },
          function(err, instance) {
            observedContexts.should.eql(aTestModelCtx({ instance: {
              id: instance.id,
              name: 'new name'
            }}));
            done();
          });
      });

      it('does not trigger `after save` hook when found', function(done) {
        TestModel.observe('after save', pushContextAndNext());

        TestModel.findOrCreate(
          { where: { id: existingInstance.id } },
          { name: existingInstance.name },
          function(err, instance) {
            observedContexts.should.eql("hook not called");
            done();
          });
      });
    });

    describe('PersistedModel.count', function(done) {
      it('triggers `query` hook', function(done) {
        TestModel.observe('query', pushContextAndNext());

        TestModel.count({ id: existingInstance.id }, function(err, count) {
          if (err) return done(err);
          observedContexts.should.eql(aTestModelCtx({ query: {
            where: { id: existingInstance.id }
          }}));
          done();
        });
      });

      it('applies updates from `query` hook', function(done) {
        TestModel.observe('query', function(ctx, next) {
          ctx.query.where = { id: existingInstance.id };
          next();
        });

        TestModel.count(function(err, count) {
          count.should.equal(1);
          done();
        });
      });
    });

    describe('PersistedModel.prototype.save', function() {
      it('triggers `before save` hook', function(done) {
        TestModel.observe('before save', pushContextAndNext());

        existingInstance.name = 'changed';
        existingInstance.save(function(err, instance) {
          if (err) return done(err);
          observedContexts.should.eql(aTestModelCtx({ instance: {
            id: existingInstance.id,
            name: 'changed'
          }}));
          done();
        });
      });

      it('aborts when `before save` hook fails', function(done) {
        TestModel.observe('before save', nextWithError(expectedError));

        existingInstance.save(function(err, instance) {
          [err].should.eql([expectedError]);
          done();
        });
      });

      it('applies updates from `before save` hook', function(done) {
        TestModel.observe('before save', function(ctx, next) {
          ctx.instance.should.be.instanceOf(TestModel);
          ctx.instance.custom = 'hook data';
          next();
        });

        existingInstance.save(function(err, instance) {
          instance.should.have.property('custom', 'hook data');
          done();
        });
      });

      it('validates model after `before save` hook', function(done) {
        TestModel.observe('before save', invalidateTestModel());

        existingInstance.save(function(err) {
          (err || {}).should.be.instanceOf(ValidationError);
          (err.details.codes || {}).should.eql({ name: ['presence'] });
          done();
        });
      });

      it('triggers `after save` hook', function(done) {
        TestModel.observe('after save', pushContextAndNext());

        existingInstance.name = 'changed';
        existingInstance.save(function(err, instance) {
          if (err) return done(err);
          observedContexts.should.eql(aTestModelCtx({ instance: {
            id: existingInstance.id,
            name: 'changed'
          }}));
          done();
        });
      });

      it('aborts when `after save` hook fails', function(done) {
        TestModel.observe('after save', nextWithError(expectedError));

        existingInstance.save(function(err, instance) {
          [err].should.eql([expectedError]);
          done();
        });
      });

      it('applies updates from `after save` hook', function(done) {
        TestModel.observe('after save', function(ctx, next) {
          ctx.instance.should.be.instanceOf(TestModel);
          ctx.instance.custom = 'hook data';
          next();
        });

        existingInstance.save(function(err, instance) {
          instance.should.have.property('custom', 'hook data');
          done();
        });
      });
    });

    describe('PersistedModel.prototype.updateAttributes', function() {
      it('triggers `before save` hook', function(done) {
        TestModel.observe('before save', pushContextAndNext());

        existingInstance.name = 'changed';
        existingInstance.updateAttributes({ name: 'changed' }, function(err) {
          if (err) return done(err);
          observedContexts.should.eql(aTestModelCtx({
            where: { id: existingInstance.id },
            data: { name: 'changed' }
          }));
          done();
        });
      });

      it('aborts when `before save` hook fails', function(done) {
        TestModel.observe('before save', nextWithError(expectedError));

        existingInstance.updateAttributes(function(err) {
          [err].should.eql([expectedError]);
          done();
        });
      });

      it('applies updates from `before save` hook', function(done) {
        TestModel.observe('before save', function(ctx, next) {
          ctx.data.custom = 'extra data';
          ctx.data.name = 'hooked name';
          ctx.data.removed = undefined;
          next();
        });

        existingInstance.updateAttributes(function(err) {
          if (err) return done(err);
          // We must query the database here because `updateAttributes`
          // returns effectively `this`, not the data from the datasource
          TestModel.findById(existingInstance.id, function(err, instance) {
            instance.toObject(true).should.eql({
              id: existingInstance.id,
              name: 'hooked name',
              custom: 'extra data'
            });
            done();
          });
        });
      });

      it('validates model after `before save` hook', function(done) {
        TestModel.observe('before save', invalidateTestModel());

        existingInstance.updateAttributes(function(err) {
          (err || {}).should.be.instanceOf(ValidationError);
          (err.details.codes || {}).should.eql({ name: ['presence'] });
          done();
        });
      });

      it('triggers `after save` hook', function(done) {
        TestModel.observe('after save', pushContextAndNext());

        existingInstance.name = 'changed';
        existingInstance.updateAttributes({ name: 'changed' }, function(err) {
          if (err) return done(err);
          observedContexts.should.eql(aTestModelCtx({ instance: {
            id: existingInstance.id,
            name: 'changed'
          }}));
          done();
        });
      });

      it('aborts when `after save` hook fails', function(done) {
        TestModel.observe('after save', nextWithError(expectedError));

        existingInstance.updateAttributes(function(err) {
          [err].should.eql([expectedError]);
          done();
        });
      });

      it('applies updates from `after save` hook', function(done) {
        TestModel.observe('after save', function(ctx, next) {
          ctx.instance.should.be.instanceOf(TestModel);
          ctx.instance.custom = 'hook data';
          next();
        });

        existingInstance.updateAttributes(function(err, instance) {
          instance.should.have.property('custom', 'hook data');
          done();
        });
      });
    });

    describe('PersistedModel.updateOrCreate', function() {
      it('triggers `query` hook on create', function(done) {
        TestModel.observe('query', pushContextAndNext());

        TestModel.updateOrCreate(
          { id: 'not-found', name: 'not found' },
          function(err, instance) {
            if (err) return done(err);
            observedContexts.should.eql(aTestModelCtx({ query: {
              where: { id: 'not-found' }
            }}));
            done();
          });
      });

      it('triggers `query` hook on update', function(done) {
        TestModel.observe('query', pushContextAndNext());

        TestModel.updateOrCreate(
          { id: existingInstance.id, name: 'new name' },
          function(err, instance) {
            if (err) return done(err);
            observedContexts.should.eql(aTestModelCtx({ query: {
              where: { id: existingInstance.id }
            }}));
            done();
          });
      });

      it('does not trigger `query` on missing id', function(done) {
        TestModel.observe('query', pushContextAndNext());

        TestModel.updateOrCreate(
          { name: 'new name' },
          function(err, instance) {
            if (err) return done(err);
            observedContexts.should.equal('hook not called');
            done();
          });
      });

      it('applies updates from `query` hook when found', function(done) {
        TestModel.observe('query', function(ctx, next) {
          ctx.query = { where: { id: { neq: existingInstance.id } } };
          next();
        });

        TestModel.updateOrCreate(
          { id: existingInstance.id, name: 'new name' },
          function(err, instance) {
            if (err) return done(err);
            findTestModels({ fields: ['id', 'name' ] }, function(err, list) {
              if (err) return done(err);
              (list||[]).map(toObject).should.eql([
                { id: existingInstance.id, name: existingInstance.name },
                { id: instance.id, name: 'new name' }
              ]);
              done();
            });
        });
      });

      it('applies updates from `query` hook when not found', function(done) {
        TestModel.observe('query', function(ctx, next) {
          ctx.query = { where: { id: 'not-found' } };
          next();
        });

        TestModel.updateOrCreate(
          { id: existingInstance.id, name: 'new name' },
          function(err, instance) {
            if (err) return done(err);
            findTestModels({ fields: ['id', 'name' ] }, function(err, list) {
              if (err) return done(err);
              (list||[]).map(toObject).should.eql([
                { id: existingInstance.id, name: existingInstance.name },
                { id: list[1].id, name: 'second' },
                { id: instance.id, name: 'new name' }
              ]);
              done();
            });
        });
      });

      it('triggers hooks only once', function(done) {
        TestModel.observe('query', pushNameAndNext('query'));
        TestModel.observe('before save', pushNameAndNext('before save'));

        TestModel.observe('query', function(ctx, next) {
          ctx.query = { where: { id: { neq: existingInstance.id } } };
          next();
        });

        TestModel.updateOrCreate(
          { id: 'ignored', name: 'new name' },
          function(err, instance) {
            if (err) return done(err);
            observersCalled.should.eql(['query', 'before save']);
            done();
          });
      });

      it('triggers `before save` hook on update', function(done) {
        TestModel.observe('before save', pushContextAndNext());

        TestModel.updateOrCreate(
          { id: existingInstance.id, name: 'updated name' },
          function(err, instance) {
            if (err) return done(err);
            observedContexts.should.eql(aTestModelCtx({ instance: {
              id: existingInstance.id,
              name: 'updated name'
            }}));
            done();
          });
      });

      it('triggers `before save` hook on create', function(done) {
        TestModel.observe('before save', pushContextAndNext());

        TestModel.updateOrCreate(
          { id: 'new-id', name: 'a name' },
          function(err, instance) {
            if (err) return done(err);
            observedContexts.should.eql(aTestModelCtx({ instance: {
              id: 'new-id',
              name: 'a name'
            }}));
            done();
          });
      });

      // NOTE(bajtos) The default implementation of `updateOrCreate` in
      // lib/dao.js loads the model first, thus any properties not set
      // in the request data are populated with existing values.
      // However, atomic implementations provided by connectors
      // don't load the object first, thus the unset values are not
      // filled from the existing data.
      it('may or may not include unset properties in `before save` on update',
        function(done) {
          TestModel.observe('before save', pushContextAndNext());

          TestModel.updateOrCreate(
            { id: existingInstance.id },
            function(err, instance) {
              if (err) return done(err);
              var name = observedContexts.instance.name;
              (name === undefined || name === existingInstance.name)
                .should.be.equal(true,
                  'name should be either undefined or ' +
                  JSON.stringify(existingInstance.name) + '; was: ' +
                  JSON.stringify(name));
              done();
            });
      });

      it('applies updates from `before save` hook on update', function(done) {
        TestModel.observe('before save', function(ctx, next) {
          ctx.instance.name = 'hooked';
          next();
        });

        TestModel.updateOrCreate(
          { id: existingInstance.id, name: 'updated name' },
          function(err, instance) {
            if (err) return done(err);
            instance.name.should.equal('hooked');
            done();
          });
      });

      it('applies updates from `before save` hook on create', function(done) {
        TestModel.observe('before save', function(ctx, next) {
          ctx.instance.name = 'hooked';
          next();
        });

        TestModel.updateOrCreate(
          { id: 'new-id', name: 'new name' },
          function(err, instance) {
            if (err) return done(err);
            instance.name.should.equal('hooked');
            done();
          });
      });

      // FIXME(bajtos) this fails with connector-specific updateOrCreate
      // implementations, see the comment inside lib/dao.js (updateOrCreate)
      it.skip('validates model after `before save` hook on update', function(done) {
        TestModel.observe('before save', invalidateTestModel());

        TestModel.updateOrCreate(
          { id: existingInstance.id, name: 'updated name' },
          function(err, instance) {
            (err || {}).should.be.instanceOf(ValidationError);
            (err.details.codes || {}).should.eql({ name: ['presence'] });
            done();
          });
      });

      // FIXME(bajtos) this fails with connector-specific updateOrCreate
      // implementations, see the comment inside lib/dao.js (updateOrCreate)
      it.skip('validates model after `before save` hook on create', function(done) {
        TestModel.observe('before save', invalidateTestModel());

        TestModel.updateOrCreate(
          { id: 'new-id', name: 'new name' },
          function(err, instance) {
            (err || {}).should.be.instanceOf(ValidationError);
            (err.details.codes || {}).should.eql({ name: ['presence'] });
            done();
          });
      });


      it('triggers `after save` hook on update', function(done) {
        TestModel.observe('after save', pushContextAndNext());

        TestModel.updateOrCreate(
          { id: existingInstance.id, name: 'updated name' },
          function(err, instance) {
            if (err) return done(err);
            observedContexts.should.eql(aTestModelCtx({ instance: {
              id: existingInstance.id,
              name: 'updated name'
            }}));
            done();
          });
      });

      it('triggers `after save` hook on create', function(done) {
        TestModel.observe('after save', pushContextAndNext());

        TestModel.updateOrCreate(
          { id: 'new-id', name: 'a name' },
          function(err, instance) {
            if (err) return done(err);
            observedContexts.should.eql(aTestModelCtx({ instance: {
              id: 'new-id',
              name: 'a name'
            }}));
            done();
          });
      });
    });

    describe('PersistedModel.deleteAll', function() {
      it('triggers `query` hook with query', function(done) {
        TestModel.observe('query', pushContextAndNext());

        TestModel.deleteAll({ name: existingInstance.name }, function(err) {
          if (err) return done(err);
          observedContexts.should.eql(aTestModelCtx({
             query: { where: { name: existingInstance.name } }
          }));
          done();
        });
      });

      it('triggers `query` hook without query', function(done) {
        TestModel.observe('query', pushContextAndNext());

        TestModel.deleteAll(function(err) {
          if (err) return done(err);
          observedContexts.should.eql(aTestModelCtx({ query: { where: {} } }));
          done();
        });
      });

      it('applies updates from `query` hook', function(done) {
        TestModel.observe('query', function(ctx, next) {
          ctx.query = { where: { id: { neq: existingInstance.id } } };
          next();
        });

        TestModel.deleteAll(function(err) {
          if (err) return done(err);
          findTestModels(function(err, list) {
            if (err) return done(err);
            (list || []).map(get('id')).should.eql([existingInstance.id]);
            done();
          });
        });
      });

      it('triggers `after delete` hook without query', function(done) {
        TestModel.observe('after delete', pushContextAndNext());

        TestModel.deleteAll(function(err) {
          if (err) return done(err);
          observedContexts.should.eql(aTestModelCtx({ where: {} }));
          done();
        });
      });

      it('triggers `after delete` hook without query', function(done) {
        TestModel.observe('after delete', pushContextAndNext());

        TestModel.deleteAll({ name: existingInstance.name }, function(err) {
          if (err) return done(err);
          observedContexts.should.eql(aTestModelCtx({
            where: { name: existingInstance.name }
          }));
          done();
        });
      });

      it('aborts when `after delete` hook fails', function(done) {
        TestModel.observe('after delete', nextWithError(expectedError));

        TestModel.deleteAll(function(err) {
          [err].should.eql([expectedError]);
          done();
        });
      });
    });

    describe('PersistedModel.prototype.delete', function() {
      it('triggers `query` hook', function(done) {
        TestModel.observe('query', pushContextAndNext());

        existingInstance.delete(function(err) {
          if (err) return done(err);
          observedContexts.should.eql(aTestModelCtx({
             query: { where: { id: existingInstance.id } }
          }));
          done();
        });
      });

      it('applies updated from `query` hook', function(done) {
        TestModel.observe('query', function(ctx, next) {
          ctx.query = { where: { id: { neq: existingInstance.id } } };
          next();
        });

        existingInstance.delete(function(err) {
          if (err) return done(err);
          findTestModels(function(err, list) {
            if (err) return done(err);
            (list || []).map(get('id')).should.eql([existingInstance.id]);
            done();
          });
        });
      });

      it('triggers `after delete` hook', function(done) {
        TestModel.observe('after delete', pushContextAndNext());

        existingInstance.delete(function(err) {
          if (err) return done(err);
          observedContexts.should.eql(aTestModelCtx({
            where: { id: existingInstance.id }
          }));
          done();
        });
      });

      it('triggers `after delete` hook without query', function(done) {
        TestModel.observe('after delete', pushContextAndNext());

        TestModel.deleteAll({ name: existingInstance.name }, function(err) {
          if (err) return done(err);
          observedContexts.should.eql(aTestModelCtx({
            where: { name: existingInstance.name }
          }));
          done();
        });
      });

      it('aborts when `after delete` hook fails', function(done) {
        TestModel.observe('after delete', nextWithError(expectedError));

        TestModel.deleteAll(function(err) {
          [err].should.eql([expectedError]);
          done();
        });
      });

      it('triggers hooks only once', function(done) {
        TestModel.observe('query', pushNameAndNext('query'));
        TestModel.observe('after delete', pushNameAndNext('after delete'));
        TestModel.observe('query', function(ctx, next) {
          ctx.query = { where: { id: { neq: existingInstance.id } } };
          next();
        });

        existingInstance.delete(function(err) {
          if (err) return done(err);
          observersCalled.should.eql(['query', 'after delete']);
          done();
        });
      });
    });

    //
    // TODO(bajtos) DISCUSSION POINT update/updateAll
    // OOPS, THERE IS NO WAY HOW TO EMIT before-save HOOK FROM JUGGLER
    // after-save can be emitted by manually querying the DB, that's expensive
    // alternatively after-save hook can be emitted with the `where` query
    // instead of the model(s) that are updated

    function pushContextAndNext() {
      return function(context, next) {
        context = deepCloneToObject(context);

        if (typeof observedContexts === 'string') {
          observedContexts = context;
          return next();
        }

        if (!Array.isArray(observedContexts)) {
          observedContexts = [observedContexts];
        }

        observedContexts.push(context);
        next();
      };
    }

    function pushNameAndNext(name) {
      return function(context, next) {
        observersCalled.push(name);
        next();
      };
    }

    function nextWithError(err) {
      return function(context, next) {
        next(err);
      };
    }

    function invalidateTestModel() {
      return function(context, next) {
        if (context.instance) {
          context.instance.name = '';
        } else {
          context.data.name = '';
        }
        next();
      };
    }

    function aTestModelCtx(ctx) {
      ctx.Model = TestModel;
      return deepCloneToObject(ctx);
    }

    function findTestModels(query, cb) {
      if (cb === undefined && typeof query === 'function') {
        cb = query;
        query = null;
      }

      TestModel.find(query, { notify: false }, cb);
    }
  });

  function deepCloneToObject(obj) {
    return traverse(obj).map(function(x) {
      if (x && x.toObject)
        return x.toObject(true);
      if (x && typeof x === 'function' && x.modelName)
        return '[ModelCtor ' + x.modelName + ']';
    });
  }

  function get(propertyName) {
    return function(obj) {
      return obj[propertyName];
    };
  }

  function toObject(obj) {
    return obj.toObject ? obj.toObject() : obj;
  }
};
