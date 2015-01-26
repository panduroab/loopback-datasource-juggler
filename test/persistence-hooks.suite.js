var DataSource = require('../').DataSource;
var ValidationError = require('../').ValidationError;
var traverse = require('traverse');

module.exports = function(connectorFactory, should) {
  describe('Persistence hooks', function() {
    var observedContexts, expectedError, observersCalled;
    var ds, TestModel, existingModel;

    beforeEach(function setupEnv(done) {
      observedContexts = "hook not called";
      expectedError = new Error('test error');
      observersCalled = [];

      ds = new DataSource({ connector: connectorFactory });
      TestModel = ds.createModel('TestModel', {
        name: { type: String, required: true },
        id: { type: String, id: true }
      });

      TestModel.create({ name: 'first' }, function(err, model) {
        if (err) return done(err);
        existingModel = model;

        TestModel.create({ name: 'second' }, function(err) {
          if (err) return done(err);
          done();
        });
      });
    });

    describe('PersistedModel.find', function() {
      it('triggers `before load` hook', function(done) {
        TestModel.observe('before load', pushContextAndNext());

        TestModel.find({ where: { id: '1' } }, function(err, list) {
          if (err) return done(err);
          observedContexts.should.eql({ query: { where: { id: '1' } } });
          done();
        });
      });

      it('aborts when `before load` hook fails', function(done) {
        TestModel.observe('before load', nextWithError(expectedError));

        TestModel.find(function(err, list) {
          [err].should.eql([expectedError]);
          done();
        });
      });

      it('applies updates from `before load` hook', function(done) {
        TestModel.observe('before load', function(ctx, next) {
          ctx.query.where = { id: existingModel.id };
          next();
        });

        TestModel.find(function(err, list) {
          list.map(get('name')).should.eql([existingModel.name]);
          done();
        });
      });

      // TODO(bajtos) geo query
    });

    describe('PersistedModel.create', function() {
      it('triggers `before save` hook', function(done) {
        TestModel.observe('before save', pushContextAndNext());

        TestModel.create({ name: 'created' }, function(err, model) {
          if (err) return done(err);
          observedContexts.should.eql({ model: {
            id: undefined,
            name: 'created'
          }});
          done();
        });
      });

      it('aborts when `before save` hook fails', function(done) {
        TestModel.observe('before save', nextWithError(expectedError));

        TestModel.create({ name: 'created' }, function(err, model) {
          [err].should.eql([expectedError]);
          done();
        });
      });

      it('applies updates from `before save` hook', function(done) {
        TestModel.observe('before save', function(ctx, next) {
          ctx.model.should.be.instanceOf(TestModel);
          ctx.model.custom = 'hook data';
          next();
        });

        TestModel.create({ name: 'a-name' }, function(err, model) {
          model.should.have.property('custom', 'hook data');
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
              { model: { id: undefined, name: 'one' } },
              { model: { id: undefined, name: 'two' } },
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

        TestModel.create({ name: 'created' }, function(err, model) {
          if (err) return done(err);
          observedContexts.should.eql({ model: {
            id: model.id,
            name: 'created'
          }});
          done();
        });
      });

      it('aborts when `after save` hook fails', function(done) {
        TestModel.observe('after save', nextWithError(expectedError));

        TestModel.create({ name: 'created' }, function(err, model) {
          [err].should.eql([expectedError]);
          done();
        });
      });

      it('applies updates from `after save` hook', function(done) {
        TestModel.observe('after save', function(ctx, next) {
          ctx.model.should.be.instanceOf(TestModel);
          ctx.model.custom = 'hook data';
          next();
        });

        TestModel.create({ name: 'a-name' }, function(err, model) {
          model.should.have.property('custom', 'hook data');
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
              { model: { id: list[0].id, name: 'one' } },
              { model: { id: list[1].id, name: 'two' } },
            ]);
            done();
          });
      });

      it('emits `after save` when some models were not saved', function(done) {
        TestModel.observe('before save', function(ctx, next) {
          if (ctx.model.name === 'fail')
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

            observedContexts.should.eql({
              model: { id: list[0].id, name: 'ok' }
            });
            done();
          });
      });
    });

    describe('PersistedModel.findOrCreate', function() {
      it('triggers `before load` hook', function(done) {
        TestModel.observe('before load', pushContextAndNext());

        TestModel.findOrCreate(
          { where: { name: 'new-record' } },
          { name: 'new-record' },
          function(err, record, created) {
            if (err) return done(err);
            observedContexts.should.eql({ query: {
              where: { name: 'new-record' },
              limit: 1,
              offset: 0,
              skip: 0
            }});
            done();
          });
      });

      // TODO(bajtos) DISCUSSION POINT
      // Perhaps it's ok to let default impl not fire the event
      // and connector-specific optimized impls to fire it?
      it.skip('triggers `before save` hook when found', function(done) {
        TestModel.observe('before save', pushContextAndNext());

        TestModel.findOrCreate(
          { where: { name: existingModel.name } },
          { name: existingModel.name },
          function(err, record, created) {
            if (err) return done(err);
            observedContexts.should.eql({ model: {
              id: undefined,
              name: existingModel.name
            }});
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
            observedContexts.should.eql({ model: {
              id: undefined,
              name: 'new-record'
            }});
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
              'before load',
              'before save',
              'after save'
            ]);
            done();
          });
      });

      it('aborts when `before load` hook fails', function(done) {
        TestModel.observe('before load', nextWithError(expectedError));

        TestModel.findOrCreate(
          { where: { id: 'does-not-exist' } },
          { name: 'does-not-exist' },
          function(err, model) {
            [err].should.eql([expectedError]);
            done();
          });
      });

      it('aborts when `before save` hook fails', function(done) {
        TestModel.observe('before save', nextWithError(expectedError));

        TestModel.findOrCreate(
          { where: { id: 'does-not-exist' } },
          { name: 'does-not-exist' },
          function(err, model) {
            [err].should.eql([expectedError]);
            done();
          });
      });

      it('triggers `after save` hook when not found', function(done) {
        TestModel.observe('after save', pushContextAndNext());

        TestModel.findOrCreate(
          { where: { name: 'new name' } },
          { name: 'new name' },
          function(err, model) {
            observedContexts.should.eql({ model: {
              id: model.id,
              name: 'new name'
            }});
            done();
          });
      });

      it('does not trigger `after save` hook when found', function(done) {
        TestModel.observe('after save', pushContextAndNext());

        TestModel.findOrCreate(
          { where: { id: existingModel.id } },
          { name: existingModel.name },
          function(err, model) {
            observedContexts.should.eql("hook not called");
            done();
          });
      });
    });

    describe('PersistedModel.count', function(done) {
      it('triggers `before load` hook', function(done) {
        TestModel.observe('before load', pushContextAndNext());

        TestModel.count({ id: existingModel.id }, function(err, count) {
          if (err) return done(err);
          observedContexts.should.eql({ query: {
            where: { id: existingModel.id }
          }});
          done();
        });
      });

      it('applies updates from `before load` hook', function(done) {
        TestModel.observe('before load', function(ctx, next) {
          ctx.query.where = { id: existingModel.id };
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

        existingModel.name = 'changed';
        existingModel.save(function(err, model) {
          if (err) return done(err);
          observedContexts.should.eql({ model: {
            id: existingModel.id,
            name: 'changed'
          }});
          done();
        });
      });

      it('aborts when `before save` hook fails', function(done) {
        TestModel.observe('before save', nextWithError(expectedError));

        existingModel.save(function(err, model) {
          [err].should.eql([expectedError]);
          done();
        });
      });

      it('applies updates from `before save` hook', function(done) {
        TestModel.observe('before save', function(ctx, next) {
          ctx.model.should.be.instanceOf(TestModel);
          ctx.model.custom = 'hook data';
          next();
        });

        existingModel.save(function(err, model) {
          model.should.have.property('custom', 'hook data');
          done();
        });
      });

      it('validates model after `before save` hook', function(done) {
        TestModel.observe('before save', invalidateTestModel());

        existingModel.save(function(err) {
          (err || {}).should.be.instanceOf(ValidationError);
          (err.details.codes || {}).should.eql({ name: ['presence'] });
          done();
        });
      });

      it('triggers `after save` hook', function(done) {
        TestModel.observe('after save', pushContextAndNext());

        existingModel.name = 'changed';
        existingModel.save(function(err, model) {
          if (err) return done(err);
          observedContexts.should.eql({ model: {
            id: existingModel.id,
            name: 'changed'
          }});
          done();
        });
      });

      it('aborts when `after save` hook fails', function(done) {
        TestModel.observe('after save', nextWithError(expectedError));

        existingModel.save(function(err, model) {
          [err].should.eql([expectedError]);
          done();
        });
      });

      it('applies updates from `after save` hook', function(done) {
        TestModel.observe('after save', function(ctx, next) {
          ctx.model.should.be.instanceOf(TestModel);
          ctx.model.custom = 'hook data';
          next();
        });

        existingModel.save(function(err, model) {
          model.should.have.property('custom', 'hook data');
          done();
        });
      });
    });

    describe('PersistedModel.prototype.updateAttributes', function() {
      it('triggers `before save` hook', function(done) {
        TestModel.observe('before save', pushContextAndNext());

        existingModel.name = 'changed';
        existingModel.updateAttributes({ name: 'changed' }, function(err) {
          if (err) return done(err);
          observedContexts.should.eql({ model: {
            id: existingModel.id,
            name: 'changed'
          }});
          done();
        });
      });

      it('aborts when `before save` hook fails', function(done) {
        TestModel.observe('before save', nextWithError(expectedError));

        existingModel.updateAttributes(function(err) {
          [err].should.eql([expectedError]);
          done();
        });
      });

      it('applies updates from `before save` hook', function(done) {
        TestModel.observe('before save', function(ctx, next) {
          ctx.model.should.be.instanceOf(TestModel);
          ctx.model.custom = 'extra data';
          ctx.model.name = 'hooked name';
          ctx.model.removed = undefined;
          next();
        });

        existingModel.updateAttributes(function(err) {
          if (err) return done(err);
          // We must query the database here because `updateAttributes`
          // returns effectively `this`, not the data from the datasource
          TestModel.findById(existingModel.id, function(err, model) {
            model.toObject(true).should.eql({
              id: existingModel.id,
              name: 'hooked name',
              custom: 'extra data'
            });
            done();
          });
        });
      });

      it('validates model after `before save` hook', function(done) {
        TestModel.observe('before save', invalidateTestModel());

        existingModel.updateAttributes(function(err) {
          (err || {}).should.be.instanceOf(ValidationError);
          (err.details.codes || {}).should.eql({ name: ['presence'] });
          done();
        });
      });

      it('triggers `after save` hook', function(done) {
        TestModel.observe('after save', pushContextAndNext());

        existingModel.name = 'changed';
        existingModel.updateAttributes({ name: 'changed' }, function(err) {
          if (err) return done(err);
          observedContexts.should.eql({ model: {
            id: existingModel.id,
            name: 'changed'
          }});
          done();
        });
      });

      it('aborts when `after save` hook fails', function(done) {
        TestModel.observe('after save', nextWithError(expectedError));

        existingModel.updateAttributes(function(err) {
          [err].should.eql([expectedError]);
          done();
        });
      });

      it('applies updates from `after save` hook', function(done) {
        TestModel.observe('after save', function(ctx, next) {
          ctx.model.should.be.instanceOf(TestModel);
          ctx.model.custom = 'hook data';
          next();
        });

        existingModel.updateAttributes(function(err, model) {
          model.should.have.property('custom', 'hook data');
          done();
        });
      });
    });

    describe('PersistedModel.updateOrCreate', function() {
      // TODO(bajtos) DISCUSSION POINT
      // Should we trigger the `before load` hook at all?
      // Use case in mind: `before load` hook adds the current userId
      // to the query to ensure that the user is not accessing an instance
      // he is not allowed to.
      // But then: this should be handled by ACLs, not by hooks right?
      //
      // The trouble with `before load` hook:
      // How to pass the modified "where" filter to connector's
      // updateOrCreate method, when the method signature does not
      // accept extra where conditions?
      it.skip('triggers `before load` hook on create', function(done) {
        TestModel.observe('before load', pushContextAndNext());

        TestModel.updateOrCreate(
          { id: 'not-found', name: 'not found' },
          function(err, model) {
            if (err) return done(err);
            observedContexts.should.eql({ query: {
              where: { id: 'not-found' }
            }});
            done();
          });
      });

      it.skip('triggers `before load` hook on update', function(done) {
        TestModel.observe('before load', pushContextAndNext());

        TestModel.updateOrCreate(
          { id: existingModel.id, name: 'new name' },
          function(err, model) {
            if (err) return done(err);
            observedContexts.should.eql({ query: {
              where: { id: existingModel.id }
            }});
            done();
          });
      });

      it('does not trigger `before load` on missing id', function(done) {
        TestModel.observe('before load', pushContextAndNext());

        TestModel.updateOrCreate(
          { name: 'new name' },
          function(err, model) {
            if (err) return done(err);
            observedContexts.should.equal('hook not called');
            done();
          });
      });

      it.skip('applies updates from `before load` hook when found');
      it.skip('applies updates from `before load` hook when not found');

      it('triggers `before save` hook on update', function(done) {
        TestModel.observe('before save', pushContextAndNext());

        TestModel.updateOrCreate(
          { id: existingModel.id, name: 'updated name' },
          function(err, model) {
            if (err) return done(err);
            observedContexts.should.eql({ model: {
              id: existingModel.id,
              name: 'updated name'
            }});
            done();
          });
      });

      it('triggers `before save` hook on create', function(done) {
        TestModel.observe('before save', pushContextAndNext());

        TestModel.updateOrCreate(
          { id: 'new-id', name: 'a name' },
          function(err, model) {
            if (err) return done(err);
            observedContexts.should.eql({ model: {
              id: 'new-id',
              name: 'a name'
            }});
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
            { id: existingModel.id },
            function(err, model) {
              if (err) return done(err);
              var name = observedContexts.model.name;
              (name === undefined || name === existingModel.name)
                .should.be.equal(true,
                  'name should be either undefined or ' +
                  JSON.stringify(existingModel.name) + '; was: ' +
                  JSON.stringify(name));
              done();
            });
      });

      it('applies updates from `before save` hook on update', function(done) {
        TestModel.observe('before save', function(ctx, next) {
          ctx.model.name = 'hooked';
          next();
        });

        TestModel.updateOrCreate(
          { id: existingModel.id, name: 'updated name' },
          function(err, model) {
            if (err) return done(err);
            model.name.should.equal('hooked');
            done();
          });
      });

      it('applies updates from `before save` hook on create', function(done) {
        TestModel.observe('before save', function(ctx, next) {
          ctx.model.name = 'hooked';
          next();
        });

        TestModel.updateOrCreate(
          { id: 'new-id', name: 'new name' },
          function(err, model) {
            if (err) return done(err);
            model.name.should.equal('hooked');
            done();
          });
      });

      // FIXME(bajtos) this fails with connector-specific updateOrCreate
      // implementations, see the comment inside lib/dao.js (updateOrCreate)
      it.skip('validates model after `before save` hook on update', function(done) {
        TestModel.observe('before save', invalidateTestModel());

        TestModel.updateOrCreate(
          { id: existingModel.id, name: 'updated name' },
          function(err, model) {
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
          function(err, model) {
            (err || {}).should.be.instanceOf(ValidationError);
            (err.details.codes || {}).should.eql({ name: ['presence'] });
            done();
          });
      });


      it('triggers `after save` hook on update', function(done) {
        TestModel.observe('after save', pushContextAndNext());

        TestModel.updateOrCreate(
          { id: existingModel.id, name: 'updated name' },
          function(err, model) {
            if (err) return done(err);
            observedContexts.should.eql({ model: {
              id: existingModel.id,
              name: 'updated name'
            }});
            done();
          });
      });

      it('triggers `after save` hook on create', function(done) {
        TestModel.observe('after save', pushContextAndNext());

        TestModel.updateOrCreate(
          { id: 'new-id', name: 'a name' },
          function(err, model) {
            if (err) return done(err);
            observedContexts.should.eql({ model: {
              id: 'new-id',
              name: 'a name'
            }});
            done();
          });
      });

      // TODO: order of hooks (load, save) - only if we notify load hooks
    });

    describe('PersistedModel.deleteAll', function() {
      it('triggers `before delete` hook with query', function(done) {
        TestModel.observe('before delete', pushContextAndNext());

        TestModel.deleteAll({ name: existingModel.name }, function(err) {
          if (err) return done(err);
          observedContexts.should.eql({ where: { name: existingModel.name } });
          done();
        });
      });

      it('triggers `before delete` hook without query', function(done) {
        TestModel.observe('before delete', pushContextAndNext());

        TestModel.deleteAll(function(err) {
          if (err) return done(err);
          observedContexts.should.eql({ where: {} });
          done();
        });
      });

      it('applies updates from `before delete` hook', function(done) {
        TestModel.observe('before delete', function(ctx, next) {
          ctx.where.id =  { neq: existingModel.id };
          next();
        });

        TestModel.deleteAll(function(err) {
          if (err) return done(err);
          TestModel.find(function(err, list) {
            if (err) return done(err);
            (list || []).map(get('id')).should.eql([existingModel.id]);
            done();
          });
        });
      });

      it('triggers `after delete` hook without query', function(done) {
        TestModel.observe('after delete', pushContextAndNext());

        TestModel.deleteAll(function(err) {
          if (err) return done(err);
          observedContexts.should.eql({ where: {} });
          done();
        });
      });

      it('triggers `after delete` hook without query', function(done) {
        TestModel.observe('after delete', pushContextAndNext());

        TestModel.deleteAll({ name: existingModel.name }, function(err) {
          if (err) return done(err);
          observedContexts.should.eql({ where: { name: existingModel.name } });
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
      it('triggers `before delete` hook', function(done) {
        TestModel.observe('before delete', pushContextAndNext());

        existingModel.delete(function(err) {
          if (err) return done(err);
          observedContexts.should.eql({ where: { id: existingModel.id } });
          done();
        });
      });

      // TODO(bajtos) DISCUSSION POINT This has a similar problem as
      // `updateOrCreate` and `before load` hook. When the hook modifies
      // the "where" query, there isn't a straightforward way how to
      // apply the updated query
      it.skip('applies updates from `before delete` hook', function(done) {
        TestModel.observe('before delete', function(ctx, next) {
          ctx.where.id = { neq: existingModel.id };
          next();
        });

        existingModel.delete(function(err) {
          if (err) return done(err);
          TestModel.find(function(err, list) {
            if (err) return done(err);
            var ids = (list || []).map(get('id'));
            ids.should.include(existingModel.id);
            done();
          });
        });
      });

      it('triggers `after delete` hook', function(done) {
        TestModel.observe('after delete', pushContextAndNext());

        existingModel.delete(function(err) {
          if (err) return done(err);
          observedContexts.should.eql({ where: { id: existingModel.id } });
          done();
        });
      });

      it('triggers `after delete` hook without query', function(done) {
        TestModel.observe('after delete', pushContextAndNext());

        TestModel.deleteAll({ name: existingModel.name }, function(err) {
          if (err) return done(err);
          observedContexts.should.eql({ where: { name: existingModel.name } });
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

    //
    // TODO(bajtos) DISCUSSION POINT update/updateAll
    // OOPS, THERE IS NO WAY HOW TO EMIT before-save HOOK FROM JUGGLER
    // after-save can be emitted by manually querying the DB, that's expensive
    // alternatively after-save hook can be emitted with the `where` query
    // instead of the model(s) that are updated

    // TODO(bajtos) DISCUSSION POINT: should we test that relations methods
    // notify hook observers too?

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

    function addObserverNameAndNext(name) {
      return function(context, next) {
        observersCalled.push(name);
      };
    }

    function nextWithError(err) {
      return function(context, next) {
        next(err);
      };
    }

    function invalidateTestModel() {
      return function(context, next) {
        context.model.name = '';
        next();
      };
    }
  });

  function deepCloneToObject(obj) {
    return traverse(obj).map(function(x) {
      if (x && x.toObject) return x.toObject(true);
    });
  }

  function get(propertyName) {
    return function(obj) {
      return obj[propertyName];
    };
  }
};
